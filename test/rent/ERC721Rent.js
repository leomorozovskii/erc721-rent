import assertRevert from '../helpers/assertRevert'
import { increaseTime, duration } from '../helpers/increaseTime'

const ERC20Token = artifacts.require('FakeERC20')
const ERC721Token = artifacts.require('FakeERC721')
const ERC721ComposableToken = artifacts.require('FakeERC721Composable')
const ERC721Rent = artifacts.require('ERC721Rent')

const BigNumber = web3.BigNumber

require('chai')
  .use(require('chai-as-promised'))
  .use(require('chai-bignumber')(BigNumber))
  .should()

contract('rentplace', function([
  creator,
  tokenOwner,
  tenant,
  anotherTenant,
  hacker
]) {
  const creationParams = {
    gas: 6e6,
    gasPrice: 21e9
  }
  const emptyAddress = '0x0000000000000000000000000000000000000000'
  const sentByCreator = { from: creator, ...creationParams }
  const sentByTokenOwner = { from: tokenOwner, ...creationParams }
  const sentByTenant = { from: tenant, ...creationParams }
  const sentByAnotherTenant = { from: anotherTenant, ...creationParams }
  const sentByHacker = { from: hacker, ...creationParams }

  const rentDuration = 60 * 60 * 24 // 1 day
  const landId = 1
  const composableId = 1
  const fakeTokenId = 2
  const rate = web3.toWei(1, 'ether')
  const tokenUri = 'hash'
  const initialBalance = web3.toWei(10, 'ether')

  let rentContract
  let mana
  let fakeToken
  let land
  let fakeERC721
  let fakeERC721Composable
  let endTime = web3.eth.getBlock('latest').timestamp + duration.minutes(5)

  function checkRentCreatedLog(log, tokenId, owner, rateInWei, expiresAt) {
    log.event.should.be.equal('RentCreated')
    log.args._tokenOwner.should.be.equal(owner)
    log.args._nftAddress.should.be.equal(land.address)
    log.args._tokenAddress.should.be.equal(mana.address)
    log.args._tokenId.should.be.bignumber.equal(tokenId)
    log.args._rate.should.be.bignumber.equal(rateInWei)
    log.args._expiresAt.should.be.bignumber.equal(expiresAt)
  }

  async function getRent(nftAddress, tokenId) {
    const rent = await rentContract.rentByTokenId(nftAddress, tokenId)
    return {
      id: rent[0],
      nftAddress: rent[1],
      tokenAddress: rent[2],
      owner: rent[3],
      tenant: rent[4],
      rate: rent[5],
      duration: rent[6],
      expiresAt: rent[7],
      dueTime: rent[8]
    }
  }

  async function createComposable(N) {
    await fakeERC721Composable.addTokens(composableId, [...Array(N).keys()])
  }

  beforeEach(async function() {
    // Create tokens
    mana = await ERC20Token.new(sentByCreator)
    fakeToken = await ERC20Token.new(sentByCreator)
    land = await ERC721Token.new('LAND', 'DCL', sentByCreator)
    fakeERC721 = await ERC721Token.new('FAKE', 'FAKE ERC721', sentByCreator)
    fakeERC721Composable = await ERC721ComposableToken.new(sentByCreator)
    rentContract = await ERC721Rent.new(sentByCreator)

    // Set holder of the asset and aproved on registry
    await land.mint(tokenOwner, landId)
    await land.setApprovalForAll(rentContract.address, true, sentByTokenOwner)
    await fakeERC721.setApprovalForAll(
      rentContract.address,
      true,
      sentByTokenOwner
    )
    await fakeERC721Composable.setApprovalForAll(
      rentContract.address,
      true,
      sentByTokenOwner
    )

    await fakeERC721.mint(tokenOwner, fakeTokenId)
    await fakeERC721.setApprovalForAll(
      rentContract.address,
      true,
      sentByTokenOwner
    )

    // Assign balance to buyer and allow Rent to move ERC20
    await mana.setBalance(tenant, initialBalance)
    await mana.setBalance(anotherTenant, initialBalance)
    await mana.approve(rentContract.address, 1e30, sentByTenant)
    await mana.approve(rentContract.address, 1e30, sentByAnotherTenant)

    // Mint composable
    await fakeERC721Composable.mint(tokenOwner, composableId)

    // refresh endTime with the blockchain timestamp
    endTime = web3.eth.getBlock('latest').timestamp + duration.minutes(5)
  })

  describe('Create Rent', function() {
    it('should create a Rent', async function() {
      const { logs } = await rentContract.createRent(
        land.address,
        mana.address,
        landId,
        rate,
        rentDuration,
        endTime,
        sentByTokenOwner
      )

      // Event emitted
      logs.length.should.be.equal(1)
      checkRentCreatedLog(logs[0], landId, tokenOwner, rate, endTime)

      // Check data
      const rent = await getRent(land.address, landId)
      expect(rent.owner).to.equal(tokenOwner)
      expect(rent.nftAddress).to.equal(land.address)
      expect(rent.tokenAddress).to.equal(mana.address)
      expect(rent.tenant).to.equal(emptyAddress)
      rent.rate.should.be.bignumber.equal(rate)
      rent.duration.should.be.bignumber.equal(rentDuration)
      rent.expiresAt.should.be.bignumber.equal(endTime)
      rent.dueTime.should.be.bignumber.equal(0)
    })
  })

  describe.only('Sign Rent', function() {
    it('should sign a Rent', async function() {
      await rentContract.createRent(
        land.address,
        mana.address,
        landId,
        rate,
        rentDuration,
        endTime,
        sentByTokenOwner
      )

      let tokenOwnerBalance = await mana.balanceOf(tokenOwner)
      let tenantBalance = await mana.balanceOf(tenant)

      tokenOwnerBalance.should.be.bignumber.equal(0)
      tenantBalance.should.be.bignumber.equal(initialBalance)

      const { logs } = await rentContract.signRent(
        land.address,
        landId,
        rate,
        '',
        sentByTenant
      )

      // Owner of the token should be the rentContract
      const rent = await getRent(land.address, landId)
      expect(rent.tenant).to.equal(tenant)

      const newOwner = await land.ownerOf(landId)
      expect(newOwner).to.equal(rentContract.address)

      // Balances should be changed
      tokenOwnerBalance = await mana.balanceOf(tokenOwner)
      tenantBalance = await mana.balanceOf(tenant)
      tokenOwnerBalance.should.be.bignumber.equal(rate)
      tenantBalance.should.be.bignumber.equal(initialBalance - rate)
    })
    it('should not sign an expired Rent', async function() {
      await rentContract.createRent(
        land.address,
        mana.address,
        landId,
        rate,
        rentDuration,
        endTime,
        sentByTokenOwner
      )

      await increaseTime(duration.minutes(6))

      await assertRevert(
        rentContract.signRent(land.address, landId, rate, '', sentByTenant)
      )
    })

    it('should sign a rent with a invalid token fingerPrint', async function() {
      this.timeout(999999999)
      await createComposable(10)

      await rentContract.createRent(
        fakeERC721Composable.address,
        mana.address,
        composableId,
        rate,
        rentDuration,
        endTime,
        sentByTokenOwner
      )

      const fingerprint = await fakeERC721Composable.getFingerprint(
        composableId
      )

      await rentContract.signRent(
        fakeERC721Composable.address,
        composableId,
        rate,
        fingerprint,
        sentByTenant
      )

      const rent = await getRent(fakeERC721Composable.address, composableId)
      expect(rent.tenant).to.equal(tenant)

      const newOwner = await fakeERC721Composable.ownerOf(composableId)
      expect(newOwner).to.equal(rentContract.address)
    })

    it('should not sign a rent with an invalid token fingerPrint', async function() {
      this.timeout(999999999)
      await createComposable(10)

      await rentContract.createRent(
        fakeERC721Composable.address,
        mana.address,
        composableId,
        rate,
        rentDuration,
        endTime,
        sentByTokenOwner
      )

      await assertRevert(
        rentContract.signRent(
          fakeERC721Composable.address,
          composableId,
          rate,
          '',
          sentByTenant
        )
      )
    })
    it('should not sign a rent with an invalid token fingerPrint (front-running)', async function() {
      this.timeout(999999999)
      await createComposable(10)

      await rentContract.createRent(
        fakeERC721Composable.address,
        mana.address,
        composableId,
        rate,
        rentDuration,
        endTime,
        sentByTokenOwner
      )

      const fingerprint = await fakeERC721Composable.getFingerprint(
        composableId
      )

      await fakeERC721Composable.addTokens(composableId, [1])

      await assertRevert(
        rentContract.signRent(
          fakeERC721Composable.address,
          composableId,
          rate,
          fingerprint,
          sentByTenant
        )
      )
    })
  })

  describe('finish Rent', function() {
    it('should finish completed Rent', async function() {
      await rentContract.createRent(
        land.address,
        mana.address,
        landId,
        rate,
        rentDuration,
        endTime,
        sentByTokenOwner
      )

      await rentContract.signRent(land.address, landId, rate, '', sentByTenant)
      await increaseTime(rentDuration + 1)

      let owner = await land.ownerOf(landId)
      expect(owner).to.equal(rentContract.address)

      await rentContract.finishRent(land.address, landId, sentByTokenOwner)

      owner = await land.ownerOf(landId)
      expect(owner).to.equal(tokenOwner)
    })

    it('should not finish uncompleted Rent', async function() {
      await rentContract.createRent(
        land.address,
        mana.address,
        landId,
        rate,
        rentDuration,
        endTime,
        sentByTokenOwner
      )

      await rentContract.signRent(land.address, landId, rate, '', sentByTenant)
      await increaseTime(rentDuration - 1)
      await assertRevert(
        rentContract.finishRent(land.address, landId, sentByTokenOwner)
      )
    })

    it('should not allow not-owner to finish the Rent', async function() {
      await rentContract.createRent(
        land.address,
        mana.address,
        landId,
        rate,
        rentDuration,
        endTime,
        sentByTokenOwner
      )

      await rentContract.signRent(land.address, landId, rate, '', sentByTenant)
      await increaseTime(rentDuration + 1)

      await assertRevert(
        rentContract.finishRent(land.address, landId, sentByHacker)
      )
    })
  })

  describe('Update rent token', function() {
    it('should allow tenant to update the token when is rent', async function() {
      await rentContract.createRent(
        land.address,
        mana.address,
        landId,
        rate,
        rentDuration,
        endTime,
        sentByTokenOwner
      )

      await rentContract.signRent(land.address, landId, rate, '', sentByTenant)

      let data = await land.tokenURI(landId)
      expect(data).to.equal('')

      await rentContract.update(land.address, landId, tokenUri, sentByTenant)

      data = await land.tokenURI(landId)
      expect(data).to.equal(tokenUri)
    })

    it('should not allow tenant to update the token when the rent was finished', async function() {
      await rentContract.createRent(
        land.address,
        mana.address,
        landId,
        rate,
        rentDuration,
        endTime,
        sentByTokenOwner
      )

      await rentContract.signRent(land.address, landId, rate, '', sentByTenant)
      await increaseTime(rentDuration + 1)

      await assertRevert(
        rentContract.update(land.address, landId, tokenUri, sentByTenant)
      )
    })

    it('should not allow real token owner to update token when is rent', async function() {
      await rentContract.createRent(
        land.address,
        mana.address,
        landId,
        rate,
        rentDuration,
        endTime,
        sentByTokenOwner
      )

      await rentContract.signRent(land.address, landId, rate, '', sentByTenant)

      await assertRevert(
        rentContract.update(land.address, landId, tokenUri, sentByTokenOwner)
      )
    })

    it('should not allow hacker to update token when is rent', async function() {
      await rentContract.createRent(
        land.address,
        mana.address,
        landId,
        rate,
        rentDuration,
        endTime,
        sentByTokenOwner
      )

      await rentContract.signRent(land.address, landId, rate, '', sentByTenant)

      await assertRevert(
        rentContract.update(land.address, landId, tokenUri, sentByHacker)
      )
    })

    it('should not allow hacker to update token', async function() {
      await rentContract.createRent(
        land.address,
        mana.address,
        landId,
        rate,
        rentDuration,
        endTime,
        sentByTokenOwner
      )

      await assertRevert(
        rentContract.update(land.address, landId, tokenUri, sentByHacker)
      )
    })

    it('should not allow update token not being rent', async function() {
      await assertRevert(
        rentContract.update(land.address, landId, tokenUri, sentByHacker)
      )
    })
  })

  describe('Cancel Rent', function() {
    it('should cancel a Rent', async function() {
      await rentContract.createRent(
        land.address,
        mana.address,
        landId,
        rate,
        rentDuration,
        endTime,
        sentByTokenOwner
      )

      await rentContract.cancelRent(land.address, landId, sentByTokenOwner)

      const rent = await getRent(land.address, landId)

      expect(rent.id).to.equal(
        '0x0000000000000000000000000000000000000000000000000000000000000000'
      )
    })

    it('should not allow a tenant to sign a cancelled Rent', async function() {
      await rentContract.createRent(
        land.address,
        mana.address,
        landId,
        rate,
        rentDuration,
        endTime,
        sentByTokenOwner
      )

      await rentContract.cancelRent(land.address, landId, sentByTokenOwner)

      await assertRevert(
        rentContract.signRent(land.address, landId, rate, '', sentByTenant)
      )
    })

    it('should not allow owner to cancel a started Rent', async function() {
      await rentContract.createRent(
        land.address,
        mana.address,
        landId,
        rate,
        rentDuration,
        endTime,
        sentByTokenOwner
      )
      await rentContract.signRent(land.address, landId, rate, '', sentByTenant)
      await assertRevert(
        rentContract.cancelRent(land.address, landId, sentByTokenOwner)
      )
    })

    it('should not allow owner to cancel a completed Rent', async function() {
      await rentContract.createRent(
        land.address,
        mana.address,
        landId,
        rate,
        rentDuration,
        endTime,
        sentByTokenOwner
      )
      await rentContract.signRent(land.address, landId, rate, '', sentByTenant)
      await increaseTime(rentDuration + 1)
      await rentContract.finishRent(land.address, landId, sentByTokenOwner)

      await assertRevert(
        rentContract.cancelRent(land.address, landId, sentByTokenOwner)
      )
    })

    it('should not allow hacker to cancel a Rent', async function() {
      await rentContract.createRent(
        land.address,
        mana.address,
        landId,
        rate,
        rentDuration,
        endTime,
        sentByTokenOwner
      )

      await assertRevert(
        rentContract.cancelRent(land.address, landId, sentByHacker)
      )
    })

    it('should not cancel an invalid Rent', async function() {
      await rentContract.createRent(
        land.address,
        mana.address,
        landId,
        rate,
        rentDuration,
        endTime,
        sentByTokenOwner
      )

      await assertRevert(
        rentContract.cancelRent(land.address, fakeTokenId, sentByTokenOwner)
      )
    })
  })
})
