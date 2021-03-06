#!/usr/bin/env node
'use strict';
const fs = require('fs')
const path = require('path')
const mkdirp = require('mkdirp')
const simplify = require('simplify-sdk')
const provider = require('simplify-sdk/provider')
const utilities = require('simplify-sdk/utilities')
const CBEGIN = '\x1b[32m'
const CERROR = '\x1b[31m'
const CRESET = '\x1b[0m'
const CGOOD = '\x1b[32m'
const opName = `SecOps`

var argv = require('yargs')
    .usage('simplify-secops status|patch|check|metric|snapshot [options]')
    .string('input')
    .alias('i', 'input')
    .describe('input', 'Input file contains function list')
    .default('input', 'functions.csv')
    .string('output')
    .alias('o', 'output')
    .describe('output', 'Output snapshot folder')
    .default('output', '.snapshot')
    .string('baseline')
    .alias('b', 'baseline')
    .describe('baseline', 'baseline snapshot date YYYY-MM-DD')
    .string('hours')
    .describe('hours', 'How many hours since now eg: 12 - last 12 hours')
    .alias('h', 'hours')
    .string('periods')
    .describe('periods', 'Time resolution periods eg: 5 10 30 60 N*60 in seconds')
    .alias('t', 'periods')
    .string('profile')
    .describe('profile', 'AWS Profile configuration')
    .alias('p', 'profile')
    .default('profile', 'default')
    .string('region')
    .describe('region', 'AWS Specific Region')
    .alias('r', 'region')
    .default('region', 'eu-west-1')
    .demandOption(['i'])
    .demandCommand(1)
    .argv;

var configInputFile = argv.input || 'functions.csv'
var scanOutput = {}
var cmdOPS = (argv._[0] || 'status').toUpperCase()
var lineIndex = 0
var funcList = []

var files = require('fs').readFileSync(path.join(__dirname, configInputFile), 'utf-8').split(/\r?\n/)
var headers = files[lineIndex++]

function getSnapshotFromFile(snapshotPath) {
    console.log(`${CBEGIN}Simplify${CRESET} | ${cmdOPS} Snapshot from ${snapshotPath}`)
    if (fs.existsSync(snapshotPath)) {    
        return JSON.parse(fs.readFileSync(snapshotPath).toString())
    } else {
        return undefined
    }
}

function takeSnapshotToFile(functionList, outputPath) {
    const outputDir = path.dirname(outputPath)
    if (!fs.existsSync(outputDir)) {
        mkdirp.sync(outputDir);
    }
    fs.writeFileSync(outputPath, JSON.stringify(functionList.map(f => {
        return {
            FunctionName: f.functionInfo.FunctionName,
            CodeSha256: f.functionInfo.CodeSha256,
            LastModified: f.functionInfo.LastModified,
            Version: f.functionInfo.Version,
            Layers: f.Layers.map(layer => {
                return {
                    CodeSha256: layer.Content.CodeSha256,
                    LayerVersionArn: layer.LayerVersionArn,
                    CreatedDate: layer.CreatedDate
                }
            }),
            LogGroup: { LogGroupName: f.LogGroup.logGroupName }
        }
    }), null, 2), 'utf8');
    console.log(`${CBEGIN}Simplify${CRESET} | ${cmdOPS} to ${outputPath} \x1b[32m (OK) \x1b[0m`)
}

function analyseOrPatch(args) {
    const { functionInfo, logRetention, customKmsArn, secureFunction, secureLog } = args
    return new Promise((resolve, reject) => {
        const combinedKmsKeyArn = customKmsArn || functionInfo.KMSKeyArn
        if (!functionInfo.KMSKeyArn) {
            if (cmdOPS === 'PATCH') {
                functionInfo.KMSKeyArn = combinedKmsKeyArn
                let functionConfig = {
                    FunctionName: functionInfo.FunctionName
                }
                if (secureFunction /** enabled */ && functionInfo.KMSKeyArn) {
                    functionConfig.KMSKeyArn = functionInfo.KMSKeyArn
                    simplify.updateFunctionConfiguration({
                        adaptor: provider.getFunction(),
                        functionConfig: functionConfig
                    }).then(_ => {
                        simplify.enableOrDisableLogEncryption({
                            adaptor: provider.getKMS(),
                            logger: provider.getLogger(),
                            functionInfo: functionInfo,
                            retentionInDays: logRetention,
                            enableOrDisable: secureLog
                        }).then(function (data) {
                            console.log(`${CBEGIN}Simplify${CRESET} | ${cmdOPS} ${functionInfo.FunctionName} : Configured secure logs with ${logRetention} days! \x1b[32m (OK) \x1b[0m`)
                            resolve(args)
                        }).catch(function (err) {
                            reject(`${err}`)
                        })
                    }).catch(function (err) {
                        reject(`${err}`)
                    })
                } else if (secureFunction /** enabled */ && !functionInfo.KMSKeyArn) {
                    console.error(`${CBEGIN}Simplify${CRESET} | ${cmdOPS} ${functionInfo.FunctionName} : You must provide a KMS Custom KeyId! \x1b[31m (ERROR) \x1b[0m`)
                    reject(`Missing KMS KeyId for ${functionInfo.FunctionName}`)
                } else {
                    simplify.enableOrDisableLogEncryption({
                        adaptor: provider.getKMS(),
                        logger: provider.getLogger(),
                        functionInfo: functionInfo,
                        retentionInDays: logRetention,
                        enableOrDisable: secureLog
                    }).then(function (_) {
                        console.log(`${CBEGIN}Simplify${CRESET} | ${cmdOPS} ${functionInfo.FunctionName} : Configured secure logs with ${logRetention} days! \x1b[32m (OK) \x1b[0m`)
                        resolve(args)
                    }).catch(function (err) {
                        reject(`${err}`)
                    })
                }
            } else if (cmdOPS === 'CHECK') {
                if (secureFunction) {
                    console.log(`${CBEGIN}Simplify${CRESET} | ${cmdOPS} ${functionInfo.FunctionName} : ${functionInfo.KMSKeyArn == customKmsArn ? (functionInfo.KMSKeyArn ? `Has already configure with KMS Custom KeyId \x1b[32m[GOOD]\x1b[0m` : `Provide KMS Custom KeyId to setup secure function! \x1b[33m (WARN) \x1b[0m`) : ( customKmsArn ? `Has KMS Custom KeyId but not set! \x1b[33m (WARN) \x1b[0m`: `Missing KMS Custom KeyId \x1b[33m (WARN) \x1b[0m`)}`)
                } else {
                    console.log(`${CBEGIN}Simplify${CRESET} | ${cmdOPS} ${functionInfo.FunctionName} : ${functionInfo.KMSKeyArn == customKmsArn ? `Not require to use KMS Custom KeyId \x1b[32m[GOOD]\x1b[0m` : `Not matching KMS Custom KeyIds \x1b[33m (WARN) \x1b[0m`}`)
                }
                resolve(args)
            } else {
                resolve(args)
            }
        } else {
            if (cmdOPS === 'PATCH') {
                functionInfo.KMSKeyArn = combinedKmsKeyArn
                /** record new SHA256 Code Here */
                simplify.enableOrDisableLogEncryption({
                    adaptor: provider.getKMS(),
                    logger: provider.getLogger(),
                    functionInfo: functionInfo,
                    retentionInDays: logRetention,
                    enableOrDisable: secureLog
                }).then(function (_) {
                    console.log(`${CBEGIN}Simplify${CRESET} | ${cmdOPS} ${functionInfo.FunctionName} : Configured secure logs with ${logRetention} days! \x1b[32m (OK) \x1b[0m`)
                    if (secureFunction) {
                        console.error(`${CBEGIN}Simplify${CRESET} | ${cmdOPS} ${functionInfo.FunctionName} : To enable secure function mode. You must provide a KMS Custom KeyId! \x1b[31m (ERROR) \x1b[0m`)
                    }
                    resolve(args)
                }).catch(function (err) {
                    reject(`${err}`)
                })
            } else if (cmdOPS === 'CHECK') {
                if (secureFunction) {
                    console.log(`${CBEGIN}Simplify${CRESET} | ${cmdOPS} ${functionInfo.FunctionName} : ${functionInfo.KMSKeyArn == customKmsArn ? (functionInfo.KMSKeyArn ? `Has already configure with KMS Custom KeyId \x1b[32m[GOOD]\x1b[0m` : `Provide KMS Custom KeyId to setup secure function! \x1b[33m (WARN) \x1b[0m`) : ( customKmsArn ? `Has KMS Custom KeyId but not set! \x1b[33m (WARN) \x1b[0m`: `Missing KMS Custom KeyId \x1b[33m (WARN) \x1b[0m`)}`)
                } else {
                    console.log(`${CBEGIN}Simplify${CRESET} | ${cmdOPS} ${functionInfo.FunctionName} : ${functionInfo.KMSKeyArn == customKmsArn ? `Has already configure with Custom KMS KeyId \x1b[32m[GOOD]\x1b[0m` : `Not matching KMS Custom KeyIds \x1b[33m (WARN) \x1b[0m`}`)
                }
                resolve(args)
            } else {
                resolve(args)
            }
        }
    })
}
const secOpsFunctions = function (files, callback) {
    const currentLine = files[lineIndex++]
    if (currentLine) {
        const parts = currentLine.split(',')
        if (parts.length >= 2) {
            const functionName = parts[2]
            const functionVersion = parts[3] || undefined
            const logRetention = parts[4] || 90
            const customKmsArn = parts[5] ? `arn:aws:kms:${parts[0]}:${parts[1]}:key/${parts[5]}` : null
            const secureFunction = JSON.parse((parts[6] || 'false').toLowerCase())
            const secureLog = JSON.parse((parts[7] || 'false').toLowerCase())
            if (cmdOPS === 'METRIC') {
                funcList.push({ functionInfo: { FunctionName: `${functionName}`} })
                if (lineIndex >= files.length) {
                    callback && callback(funcList)
                } else {
                    secOpsFunctions(files, callback)
                }
            } else {
                simplify.getFunctionMetaInfos({
                    adaptor: provider.getFunction(),
                    logger: provider.getLogger(),
                    functionConfig: { FunctionName: functionName, Qualifier: functionVersion },
                    silentIs: true
                }).then(function (functionMeta) {
                    const functionInfo = functionMeta.Configuration
                    if (!scanOutput[functionInfo.FunctionName]) {
                        scanOutput[functionInfo.FunctionName] = {}
                    }
                    scanOutput[functionInfo.FunctionName] = functionInfo
                    analyseOrPatch({ functionInfo, logRetention, customKmsArn, secureFunction, secureLog }).then(res => {
                        funcList.push({ ...res, Layers: functionMeta.LayerInfos, LogGroup: functionMeta.LogGroup })
                        if (lineIndex >= files.length) {
                            callback && callback(funcList)
                        } else {
                            secOpsFunctions(files, callback)
                        }
                    }).catch(err => console.log(`${CBEGIN}Simplify${CRESET} | ${cmdOPS} ${functionInfo.FunctionName} ${err} \x1b[31m (ERROR) \x1b[0m`))
                }).catch(err => console.log(`${CBEGIN}Simplify${CRESET} | ${cmdOPS} ${functionInfo.FunctionName} ${err} \x1b[31m (ERROR) \x1b[0m`))
            }
        }
    } else {
        callback && callback(funcList)
    }
}

try {
    var config = simplify.getInputConfig({
        Region: argv.region || 'eu-west-1',
        Profile: argv.profile || 'default',
        Bucket: { Name: 'default' }
    })
    provider.setConfig(config).then(function () {
        if (headers.startsWith('Region')) {
            secOpsFunctions(files, function (functionList) {
                if (cmdOPS === 'METRIC') {
                    let startDate = new Date()
                    const lastHours = parseInt(argv.hours || 3)
                    startDate.setHours(startDate.getHours() - (lastHours))
                    simplify.getFunctionMetricData({
                        adaptor: provider.getMetrics(),
                        functions: functionList.map(f => { return { FunctionName: f.functionInfo.FunctionName } }),
                        periods: parseInt(argv.periods || 300),
                        startDate: startDate,
                        endDate: new Date()
                    }).then(metrics => {
                        let thisDate = new Date()
                        thisDate.setMinutes(0)
                        let mData = {}
                        metrics.MetricDataResults.map(m => {
                            let timeValue = thisDate.toISOString()
                            const labelValue = `${m.Label}`
                            const totalValue = parseFloat(m.Values.reduce((count, x) => count + x, 0)).toFixed(labelValue === 'Duration' ? 2: 0)
                            const functionName = functionList[m.Id.split('_')[1]].functionInfo.FunctionName
                            if (!m.Values.length) {
                                m.Values.push('-')
                                m.Timestamps.push(timeValue)
                            }
                            for (let i = 0; i < m.Values.length; i++) {
                                const periodTimeValue= new Date(m.Timestamps[i]).toISOString()
                                if (!mData[periodTimeValue]) {
                                    mData[periodTimeValue] = { }
                                    mData[periodTimeValue][`DateTime (${lastHours} hours ago)`] = periodTimeValue
                                }
                                let data = {}
                                const textValue = parseFloat(m.Values[i]).toFixed(labelValue === 'Duration' ? 2: 0)
                                data[labelValue] =  labelValue === 'Duration' ? `${textValue} avg` : `${textValue} / ${totalValue}`
                                mData[periodTimeValue] = { 'Function': functionName, ...mData[periodTimeValue], ...data }
                            }
                        })
                        utilities.printTableWithJSON(Object.keys(mData).map(k => mData[k]))
                    }).catch(err => console.error(`${err}`))
                } else if (cmdOPS === 'STATUS') {
                    const snapshotList = getSnapshotFromFile(path.join(__dirname, argv.output, `${argv.baseline || '$LATEST'}.json`))
                    const outputTable = functionList.map(func => {
                        const snapshot = snapshotList ? snapshotList.find(f => f.FunctionName === func.functionInfo.FunctionName) : { Layers: [] }
                        var areLayersValid = snapshotList ? true : false
                        snapshot.Layers.map(layer => {
                            const layerInfo = func.Layers.find(info => info.LayerVersionArn === layer.LayerVersionArn)
                            if (layerInfo.Content.CodeSha256 !== layer.CodeSha256) {
                                areLayersValid = false
                            }
                        })
                        return {
                            FunctionName: func.functionInfo.FunctionName.truncateRight(20),
                            LastModified: new Date(func.functionInfo.LastModified).toISOString(),
                            State: func.functionInfo.State,
                            CodeSize: `${func.functionInfo.CodeSize} bytes`,
                            Timeout: `${func.functionInfo.Timeout} secs`,
                            CodeSha256: `${func.functionInfo.CodeSha256.truncateLeft(5)} (${func.functionInfo.CodeSha256 === snapshot.CodeSha256 ? 'OK' : 'NOK'})`,
                            Layers: `${func.Layers.length} (${areLayersValid ? 'OK' : 'NOK'})`,
                            LogRetention: `${func.LogGroup.retentionInDays || '-'} / ${func.logRetention} (${func.LogGroup.retentionInDays == func.logRetention ? 'OK': 'PATCH'})`,
                            EncryptionKey: (func.customKmsArn ? `KMS ${func.functionInfo.KMSKeyArn === func.customKmsArn ? '(OK)' : '(PATCH)'}`: `Default ${func.functionInfo.KMSKeyArn === func.customKmsArn ? '(OK)' : '(PATCH)'}`).truncateLeft(13),
                            SecureFunction: func.secureFunction ? (func.functionInfo.KMSKeyArn ? 'YES (OK)' : 'YES (PATCH)') : (func.functionInfo.KMSKeyArn ? 'NO (PATCH)' : 'NO (OK)'),
                            SecureLog: func.secureLog ? (func.LogGroup.kmsKeyId ? 'YES (OK)' : 'YES (PATCH)') : (func.LogGroup.kmsKeyId ? 'NO (PATCH)' : 'NO (OK)')
                        }
                    })
                    utilities.printTableWithJSON(outputTable)
                } else if (cmdOPS === 'SNAPSHOT') {
                    takeSnapshotToFile(functionList, path.join(__dirname, argv.output, `${utilities.getDateToday()}.json`))
                    takeSnapshotToFile(functionList, path.join(__dirname, argv.output, `$LATEST.json`))
                }
            })
        }
    })
} catch (err) {
    simplify.finishWithErrors(`${opName}-LoadConfig`, err)
}