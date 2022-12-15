const express = require('express')
const bodyParser = require('body-parser')
const msgpack = require('msgpack-lite')
const codec = msgpack.createCodec({ int64: true })
const http = require('http')
const multer = require('multer')
const upload = multer()

const { FakeAgent } = require('./helpers')

const DEFAULT_SETTINGS = {
  code_coverage: true,
  tests_skipping: true
}

const DEFAULT_SUITES_TO_SKIP = []
const DEFAULT_GIT_UPLOAD_STATUS = 200

let settings = DEFAULT_SETTINGS
let suitesToSkip = DEFAULT_SUITES_TO_SKIP
let gitUploadStatus = DEFAULT_GIT_UPLOAD_STATUS

class FakeCiVisIntake extends FakeAgent {
  setGitUploadStatus (newStatus) {
    gitUploadStatus = newStatus
  }

  setSuitesToSkip (newSuitesToSkip) {
    suitesToSkip = newSuitesToSkip
  }

  setSettings (newSettings) {
    settings = newSettings
  }

  async start () {
    const app = express()
    app.use(bodyParser.raw({ limit: Infinity, type: 'application/msgpack' }))

    app.post('/api/v2/citestcycle', (req, res) => {
      res.status(200).send('OK')
      this.emit('message', {
        headers: req.headers,
        payload: msgpack.decode(req.body, { codec }),
        url: req.url
      })
    })

    app.post('/api/v2/git/repository/search_commits', (req, res) => {
      res.status(gitUploadStatus).send(JSON.stringify({ data: [] }))
      this.emit('message', {
        headers: req.headers,
        payload: req.body,
        url: req.url
      })
    })

    app.post('/api/v2/git/repository/packfile', (req, res) => {
      res.status(202).send('')
      this.emit('message', {
        headers: req.headers,
        url: req.url
      })
    })

    app.post('/api/v2/citestcov', upload.any(), (req, res) => {
      res.status(200).send('OK')

      const coveragePayloads = req.files
        .filter((file) => file.fieldname !== 'event')
        .map((file) => {
          return {
            name: file.fieldname,
            type: file.mimetype,
            filename: file.originalname,
            content: msgpack.decode(file.buffer)
          }
        })

      this.emit('message', {
        headers: req.headers,
        payload: coveragePayloads,
        url: req.url
      })
    })

    app.post('/api/v2/libraries/tests/services/setting', (req, res) => {
      res.status(200).send(JSON.stringify({
        data: {
          attributes: settings
        }
      }))
      this.emit('message', {
        headers: req.headers,
        url: req.url
      })
    })

    app.post('/api/v2/ci/tests/skippable', (req, res) => {
      res.status(200).send(JSON.stringify({
        data: suitesToSkip
      }))
      this.emit('message', {
        headers: req.headers,
        url: req.url
      })
    })

    return new Promise((resolve, reject) => {
      const timeoutObj = setTimeout(() => {
        reject(new Error('Intake timed out starting up'))
      }, 10000)
      this.server = http.createServer(app)
      this.server.on('error', reject)
      this.server.listen(this.port, () => {
        this.port = this.server.address().port
        clearTimeout(timeoutObj)
        resolve(this)
      })
    })
  }

  async stop () {
    await super.stop()
    settings = DEFAULT_SETTINGS
    suitesToSkip = DEFAULT_SUITES_TO_SKIP
    gitUploadStatus = DEFAULT_GIT_UPLOAD_STATUS
  }

  assertPayloadReceived (fn, messageMatch, timeout) {
    let resultResolve
    let resultReject
    let error

    const timeoutObj = setTimeout(() => {
      resultReject([error, new Error('timeout')])
    }, timeout || 15000)

    const messageHandler = (message) => {
      if (!messageMatch || messageMatch(message)) {
        try {
          fn(message)
          resultResolve()
        } catch (e) {
          resultReject(e)
        }
        this.removeListener('message', messageHandler)
      }
    }
    this.on('message', messageHandler)

    return new Promise((resolve, reject) => {
      resultResolve = () => {
        clearTimeout(timeoutObj)
        resolve()
      }
      resultReject = (e) => {
        clearTimeout(timeoutObj)
        reject(e)
      }
    })
  }
}

module.exports = { FakeCiVisIntake }