pragma solidity ^0.4.23;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "openzeppelin-solidity/contracts/lifecycle/Pausable.sol";
import "openzeppelin-solidity/contracts/AddressUtils.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";

/**
 * @title Interface for contracts conforming to ERC-721
 */
contract ERC721Interface {
    function ownerOf(uint256 _tokenId) public view returns (address _owner);
    function update(uint256 _tokenId, string _uri) public;
    function approve(address _to, uint256 _tokenId) public;
    function getApproved(uint256 _tokenId) public view returns (address);
    function isApprovedForAll(address _owner, address _operator) public view returns (bool);
    function transferFrom(address _from, address _to, uint256 _tokenId) public;
    function supportsInterface(bytes4 _interfaceId) public returns (bool);
    function validateFingerprint(uint256 _tokenId, bytes fingerprint) public returns (bool);
}

/**
 * @title Interface for contracts conforming to ERC-20
 */
contract ERC20Interface {
    function transferFrom(address _from, address _to, uint256 _value) public;
}

contract ERC721Rent is Ownable, Pausable {
    using AddressUtils for address;
    using SafeMath for uint256;
    bytes4 internal constant InterfaceId_ValidateFingerprint = bytes4(keccak256("validateFingerprint(uint256,bytes)"));
    
    // Revisit events, need indexed? which ones? more info? less?
    event RentCreated(
      address _tokenOwner,
      address _nftAddress,
      address _tokenAddress,
      uint256 _tokenId,
      uint256 _rate,
      uint256 _expiresAt
    );
    event RentSigned(
      address _tenant, 
      address _nftAddress, 
      address _tokenAddress, 
      uint256 _tokenId,
      uint256 _dueTime
    );
    event RentCancelled(
      address _nftAddress, 
      address _tokenAddress, 
      uint256 _tokenId
    );
    event TokenUpdated(
      address _nftAddress, 
      address _tokenAddress, 
      uint256 _tokenId, 
      string _uri
    );
    event RentFinished(
      address _nftAddress, 
      address _tokenAddress, 
      uint256 _tokenId
    );
    
    struct Rent {
        // unique identifier for the rent
        bytes32 id;
        // NFT address
        address nftAddress;
        // ERC20 address of the token payment
        address tokenAddress;
        // address of the ERC721 owner
        address owner;
        // address of tenant 
        address tenant;
        // rental rate (in wei)
        uint256 rate;
        // duration in seconds
        uint256 duration;
        // timestamp when rental expires
        uint256 expiresAt;
        // timestamp when rental ends
        uint256 dueTime;
    }
    
    // From ERC721 tokenId to Rent (to avoid asset collision)
    mapping (address => mapping(uint256 => Rent)) public rentByTokenId;
    
    function createRent(
        address nftAddress,
        address tokenAddress,
        uint256 tokenId,
        uint256 rate,
        uint256 duration,
        uint256 expiresAt
    )
    public
    {
        require(nftAddress.isContract(), "The NFT Address should be a contract");
        require(tokenAddress.isContract(), "The Token Address should be a contract");
        require(expiresAt > block.timestamp.add(1 minutes), "ExpireAt should be bigger than 1 minute");
        require(rate > 0, "Price should be bigger than 0");
        require(duration > 3600, "Duration should be bigger than 1 minute");

        ERC721Interface nftRegistry = ERC721Interface(nftAddress);
        address tokenOwner = nftRegistry.ownerOf(tokenId);

        require(msg.sender == tokenOwner, "Only the owner can create a Rent");
        require(
            nftRegistry.getApproved(tokenId) == address(this) || nftRegistry.isApprovedForAll(tokenOwner, address(this)),
            "The contract is not authorized to manage the token"
        );
        
        bytes32 rentId = keccak256(
            abi.encodePacked(
                nftAddress,
                tokenAddress,
                tokenId,
                tokenOwner,
                rate,
                block.timestamp
            )
        );

        rentByTokenId[nftAddress][tokenId] = Rent({
            id: rentId,
            nftAddress: nftAddress,
            tokenAddress: tokenAddress,
            owner: tokenOwner,
            tenant: address(0),
            rate: rate,
            duration: duration,
            expiresAt: expiresAt,
            dueTime: 0
        });

        emit RentCreated(
            tokenOwner,
            nftAddress, 
            tokenAddress, 
            tokenId,
            rate,
            expiresAt
        );
    }

    function cancelRent(address nftAddress, uint256 tokenId) public {
        Rent memory rent = rentByTokenId[nftAddress][tokenId];

        require(rent.id != 0, "Token not listed for rent");
        require(rent.dueTime == 0, "Rent was signed");
        require(rent.owner == msg.sender || msg.sender == owner, "Unauthorized user");

        delete rentByTokenId[nftAddress][tokenId];

        emit RentCancelled(
            nftAddress,
            rent.tokenAddress,
            tokenId
        );
    }
    
    function signRent(address nftAddress, uint256 tokenId, uint256 rate, bytes nftFingerprint) public {
        Rent storage rent = rentByTokenId[nftAddress][tokenId];

        require(rent.id != 0, "Token not listed for rent");
        require(rent.owner != address(0), "Invalid address");
        require(rent.owner != msg.sender, "Unauthorized user");
        require(rent.rate == rate, "The rate is not correct");
        require(rent.expiresAt >= block.timestamp, "Rent expired");

        ERC721Interface nftRegistry = ERC721Interface(nftAddress);
        require(rent.owner == nftRegistry.ownerOf(tokenId), "The owner of the rent is not longer the actual owner");
        if (nftRegistry.supportsInterface(InterfaceId_ValidateFingerprint)) {
            require(nftRegistry.validateFingerprint(tokenId, nftFingerprint), "Invalid fingerprint");
        }

        ERC20Interface erc20Token = ERC20Interface(rent.tokenAddress);

        //TODO: check get data for token modifications
      
        // token is now part of the rent contract
        nftRegistry.transferFrom(rent.owner, address(this), tokenId);
        // Pay rent
        erc20Token.transferFrom(
            msg.sender,
            rent.owner,
            rate
        );

        // set tenant
        rent.tenant = msg.sender;
        rent.dueTime = rent.duration.add(block.timestamp);
        
        emit RentSigned(msg.sender, nftAddress, rent.tokenAddress, tokenId, rent.dueTime);
    }
  
    
  
    function finishRent(
        address nftAddress,
        uint256 tokenId
    )
      public
    {
        Rent memory rent = rentByTokenId[nftAddress][tokenId];

        ERC721Interface nftRegistry = ERC721Interface(nftAddress);

        require(rent.owner == msg.sender, "Only the owner can finish rent");
        require(rent.dueTime < block.timestamp, "Rent is not completed");

        // return token to the original owner
        nftRegistry.transferFrom(address(this), rent.owner, tokenId);
        
        emit RentFinished(nftAddress, rent.tokenAddress, tokenId);
    }
  
    function update(address nftAddress, uint256 tokenId, string uri) public {
        Rent memory rent = rentByTokenId[nftAddress][tokenId];
        
        require(rent.id != 0, "Token not listed for rent");
        require(rent.tenant == msg.sender, "Unauthorized user");
        require(rent.dueTime >= block.timestamp, "Rent is finished");
        
        ERC721Interface nftRegistry = ERC721Interface(nftAddress);
        address tokenOwner = nftRegistry.ownerOf(tokenId);

        require(address(this) == tokenOwner, "");
        nftRegistry.update(tokenId, uri);
        
        emit TokenUpdated(nftAddress, rent.tokenAddress, tokenId, uri);
    }
}