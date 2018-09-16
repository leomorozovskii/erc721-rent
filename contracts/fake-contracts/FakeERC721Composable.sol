pragma solidity ^0.4.23;

import "./FakeERC721.sol";

contract FakeERC721Composable is FakeERC721 {

    bytes4 internal constant InterfaceId_ValidateFingerprint = bytes4(keccak256("validateFingerprint(uint256,bytes)"));
    mapping(uint256 => uint256[]) composedTokensById;


    constructor() public
    FakeERC721("ERC721Composable", "ERC721C")
    { }

    function supportsInterface(bytes4 interfaceId) external view returns (bool) {
        return interfaceId == InterfaceId_ValidateFingerprint;
    }

    function addTokens(uint256 composedId, uint256[] tokenIds) external {
        uint length = tokenIds.length;
        for (uint i = 0; i < length; i++) {
            composedTokensById[composedId].push(tokenIds[i]);
        }
    }  

    function getFingerprint(uint256 composedId)
      public
      view
      returns (bytes32 result)
    {
        result = keccak256(composedId);

        uint256 length = composedTokensById[composedId].length;
        for (uint i = 0; i < length; i++) {
            result ^= keccak256(composedTokensById[composedId][i]);
        }
        return result;
    }

    function validateFingerprint(uint256 composedId, bytes fingerprint)
      public
      returns (bool)
    {
        return getFingerprint(composedId) == _bytesToBytes32(fingerprint, 0);
    }

    function _bytesToBytes32_DEPRECARED(bytes _data) internal pure returns (bytes32 _output) {
        assembly {
            mstore(_output, add(_data, 0))
            mstore(add(_data, 32), add(_data, 32))
        }
    }

    function _bytesToBytes32(bytes b, uint offset) private pure returns (bytes32) {
        bytes32 out;

        for (uint i = 0; i < 32; i++) {
            out |= bytes32(b[offset + i] & 0xFF) >> (i * 8);
        }
        return out;
    }
}
