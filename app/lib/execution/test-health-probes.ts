import { GET as getLive } from '../../api/health/live/route'
import { GET as getReady } from '../../api/health/ready/route'

async function testHealthProbes() {
  console.log('Testing Liveness Probe (GET /api/health/live)...')
  const liveRes = await getLive()
  const liveData = await liveRes.json()
  console.log('  Live Status:', liveRes.status, liveData)
  if (liveRes.status !== 200 || liveData.status !== 'ok') {
    throw new Error('Liveness probe failed')
  }

  console.log('\nTesting Readiness Probe (GET /api/health/ready)...')
  const readyRes = await getReady()
  const readyData = await readyRes.json()
  console.log('  Ready Status:', readyRes.status, readyData)
  if (readyRes.status !== 200 || readyData.database?.status !== 'connected') {
    throw new Error('Readiness probe failed')
  }

  console.log('\nAll health probes passed successfully!')
}

testHealthProbes()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
