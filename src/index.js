import './main.css';
import { Main } from './Main.elm';
import registerServiceWorker from './registerServiceWorker';
import Eos from 'eosjs'

const STORAGE_KEY = 'MONSTEREOS'
const CHAIN_PROTOCOL = 'http'
const CHAIN_HOST = '127.0.0.1'
const CHAIN_PORT = 8888
const CHAIN_ADDRESS = CHAIN_PROTOCOL + '://' + CHAIN_HOST + ':' + CHAIN_PORT
const CHAIN_ID = 'cf057bbfb72640471fd910bcb67639c22df9f92470936cddc1ade0e2f2e7dc4f' //'7d47aae09c97dbc21d52c6d9f17bb70a1f1f2fda5f81b3ef18979b74b2070d8c'
const MONSTERS_ACCOUNT = 'pet' //'monstereosi1'
const MONSTERS_TABLE = 'pets'
const BALANCES_TABLE = 'balances'
const TOKEN_SYMBOL = 'EOS'
const MEMO = 'MonsterEOS Wallet Deposit'

const storageBody = localStorage.getItem(STORAGE_KEY)
const flags = !storageBody ?
  { user: { eosAccount: "", publicKey: "" } } : JSON.parse(storageBody)

const app = Main.embed(document.getElementById('root'), flags)

/* Eos and Scatter Setup */
const network = {
  blockchain: 'eos',
  host: CHAIN_HOST,
  port: CHAIN_PORT,
  chainId: CHAIN_ID
}
const localNet = Eos({httpEndpoint: CHAIN_ADDRESS, chainId: CHAIN_ID})

let scatter = null

const scatterDetection = setTimeout(() => {
  if (scatter == null) {
    app.ports.setScatterInstalled.send(false)
  }
}, 5000)

const getAuthorization = () => {
  const account = scatter.identity.accounts.find(account => account.blockchain === 'eos')

  return {
    permission: {
      authorization: [ `${account.name}@${account.authority}` ]
    },
    account
  }
}

const getEos = () => {
  return scatter.eos(network, Eos, { chainId: CHAIN_ID })
}

const getContract = async () => {
  return getEos().contract(MONSTERS_ACCOUNT);
}

document.addEventListener('scatterLoaded', scatterExtension => {
  clearTimeout(scatterDetection)
  scatter = window.scatter
  window.scatter = null

  scatter.suggestNetwork(network)

  app.ports.setScatterInstalled.send(true)

  if (scatter.identity) {

    const user = {
        eosAccount: scatter.identity.accounts[0].name,
        publicKey: scatter.identity.publicKey
    }

    app.ports.setScatterIdentity.send(user)
  }
})

app.ports.refreshPage.subscribe(() => {
  location.reload()
})

app.ports.signOut.subscribe(() => {
  scatter.forgetIdentity()
  app.ports.setScatterInstalled.send(true)
})

app.ports.scatterRequestIdentity.subscribe(async () => {

    await scatter.suggestNetwork(network)

    let requiredFields = {
        accounts: [network]
    }
    scatter.getIdentity(requiredFields).then((identity) => {

      const user = {
          eosAccount: identity.accounts[0].name,
          publicKey: identity.publicKey
      }

      app.ports.setScatterIdentity.send(user)
    }).catch(error => {
      app.ports.scatterRejected.send("Identity or Network was rejected")
      console.error(error)
    })
})

app.ports.listMonsters.subscribe(async () => {

    const monsters = await localNet.getTableRows({
                "json": true,
                "scope": MONSTERS_ACCOUNT,
                "code": MONSTERS_ACCOUNT,
                "table": MONSTERS_TABLE,
                "limit": 5000
            }).then(res => res.rows.map(row =>
              Object.assign({}, row, {
              created_at: row.created_at * 1000,
              death_at: row.death_at * 1000,
              last_bed_at: row.last_bed_at * 1000,
              last_fed_at: row.last_fed_at * 1000,
              last_play_at: row.last_play_at * 1000,
              last_shower_at: row.last_shower_at * 1000,
              last_awake_at: row.last_awake_at * 1000,
              is_sleeping: row.is_sleeping === 1
            }))).catch(e => {
              app.ports.setMonstersFailed.send('Error while listing Monsters')
            })

    app.ports.setMonsters.send(monsters)
})

app.ports.getWallet.subscribe(async () => {

    const { account } = getAuthorization()

    const funds = await localNet.getTableRows({
          "json": true,
          "scope": account.name,
          "code": MONSTERS_ACCOUNT,
          "table": BALANCES_TABLE,
          "limit": 5000
      }).then(res => {
        if (res.rows && res.rows.length) {
          return { funds: Number(res.rows[0].funds.split(" ")[0]) }
        } else {
          return { funds: 0 }
        }
      }).catch(e => {
        app.ports.setWalletFailed.send('Error while getting current Wallet')
      })

    app.ports.setWallet.send(funds)
})

app.ports.requestDeposit.subscribe(async (depositAmount) => {

  const auth = getAuthorization()

  console.log("depositing " + depositAmount)

  const data = {
    from: auth.account.name,
    to: MONSTERS_ACCOUNT,
    quantity: depositAmount.toFixed(4) + ' ' + TOKEN_SYMBOL,
    memo: MEMO
  }

  const options = {
    broadcast: true,
    authorization: auth.permission.authorization
  }

  const contract = await getEos().contract('eosio.token')
    .catch(e => {
      console.error('fail to initialize eosio.token ', e)
      app.ports.depositFailed.send('Fail to Initialize eosio.token')
    })

  if (!contract) return

  const transfer = await contract.transfer(data, auth.permission)
    .catch(e => {
        console.error('error on deposit transfer ', e)
        const errorMsg = (e && e.message) ||
        'An error happened while making the deposit, please try again'
        app.ports.depositFailed.send(errorMsg)
      })

  if (transfer) app.ports.depositSucceed.send(transfer.transaction_id)
})

app.ports.submitNewMonster.subscribe(async (monsterName) => {

  const auth = getAuthorization()

  const contract = await getContract()

  const createpet = await contract.createpet(auth.account.name, monsterName, auth.permission)
    .catch(e => {
        console.error('error on pet creation ', e)
        const errorObj = JSON.parse(e)
        const errorMsg = (e && e.message) ||
        (errorObj && errorObj.error && errorObj.error.details && errorObj.error.details.length && errorObj.error.details[0].message) ||
        'An error happened while creating the monster'
        app.ports.monsterCreationFailed.send(errorMsg)
      })

  if (createpet) app.ports.monsterCreationSucceed.send(createpet.transaction_id)
})

app.ports.requestFeed.subscribe(async (petId) => {
  const auth = getAuthorization()

  const contract = await getContract()

  const feedpet = await contract.feedpet(petId, auth.permission)
    .catch(e => {
        console.error('error on feedpet ', e)
        const errorMsg = (e && e.message) ||
        'An error happened while feeding the monster'
        app.ports.feedFailed.send(errorMsg)
      })

  console.log(feedpet)

  if(feedpet) app.ports.feedSucceed.send(feedpet.transaction_id)
})

app.ports.requestAwake.subscribe(async (petId) => {

  const auth = getAuthorization()

  const contract = await getContract()

  const awakepet = await contract.awakepet(petId, auth.permission)
    .catch(e => {
        console.error('error on waking pet ', e)
        const errorMsg = (e && e.message) ||
        'An error happened while awaking the monster'
        app.ports.awakeFailed.send(errorMsg)
      })

  console.log(awakepet)

  if(awakepet) app.ports.awakeSucceed.send(awakepet.transaction_id)
})

app.ports.requestBed.subscribe(async (petId) => {
  const auth = getAuthorization()

  const contract = await getContract()

  const bedpet = await contract.bedpet(petId, auth.permission)
    .catch(e => {
        console.error('error on bed pet ', e)
        const errorMsg = (e && e.message) ||
        'An error happened while attempting to bed the monster'
        app.ports.bedFailed.send(errorMsg)
      })

  console.log(bedpet)

  if(bedpet) app.ports.bedSucceed.send(bedpet.transaction_id)
})

app.ports.requestPlay.subscribe(async (petId) => {
  app.ports.feedSucceed.send('lazy developer must build "Play" action')
})

app.ports.requestWash.subscribe(async (petId) => {
  app.ports.feedSucceed.send('lazy developer must build "Wash" action')
})

registerServiceWorker();
