# ERC721 Rent Contract

## Simple summary

Contract used to rent ERC721 and ERC721 composables

## Interface

```solidity
pragma solidity ^0.4.20;


interface ERC721Rent {
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

    function createRent(
        address nftAddress,
        address tokenAddress,
        uint256 tokenId,
        uint256 rate,
        uint256 duration,
        uint256 expiresAt
    )
    public;

    function cancelRent(address nftAddress, uint256 tokenId) public;

    function signRent(address nftAddress, uint256 tokenId, uint256 rate, bytes nftFingerprint) public;

    function finishRent(address nftAddress, uint256 tokenId) public;

    function updateToken(address nftAddress, uint256 tokenId, string tokenUri) public;
}
```
