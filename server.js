const {
    dialogflow,
    BasicCard,
    Image,
    Permission,
    Suggestions,
} = require('actions-on-google');

const express = require('express');
const bodyParser = require('body-parser');

const elasticsearch = require('@elastic/elasticsearch');
const intervalParser = require('iso8601-duration');
const D3Node = require('d3-node')

const canvasModule = require('canvas');
const d3n = new D3Node({ canvasModule });

const config = require('/etc/gaconf/config.json');
// const config = require('./kube/secrets/config.json');

es = new elasticsearch.Client({ node: config.ES_HOST, log: 'error' });



const expressApp = express().use(bodyParser.json());

const app = dialogflow({ debug: true });

function humanFileSize(size) {
    var i = Math.floor(Math.log(size) / Math.log(1024));
    return (size / Math.pow(1024, i)).toFixed(2) * 1 + ' ' + ['B', 'kB', 'MB', 'GB', 'TB'][i];
};

function getDuration(d) {
    const dmap = {
        's': [1, 'second'],
        'min': [60, 'minute'],
        'h': [3600, 'hour'],
        'day': [86400, 'day'],
        'wk': [7 * 86400, 'week'],
        'mo': [86400 * 30, 'month'],
    }
    if (d.unit in dmap) {
        var unit_text = dmap[d.unit][1];
        if (d.amount > 0) unit_text += 's';
        return [d.amount * dmap[d.unit][0] * 1000, unit_text];
    }
    else {
        console.error('unrecognized unit:', d);
        return d.amount * 1000;
    }
}

function getRandReprompt() {
    const reprompts = [
        '\nTo learn all options say "Help".',
        '\nWould you like to know status of an ADC system? Say "get system status".',
        '\nTo learn about your grid jobs, say "get my jobs" or "get my tasks".',
        '\nTo get state of an ATLAS site, say "get my site".',
        '\nMaybe check your data size? Say "my data".',
        '\nMaybe check state of your transfers? Say "my transfers".',
        '\nTo check your transfers say for example "my transfers in last week".',
        '\nTo check persfonar indexing say "get perfsonar status".',
        '\nTo check FTS status say "Check FTS system status".',
        '\nTo exit ATLAS computing skill say "Stop".'
    ]
    return (reprompts[Math.floor(Math.random() * reprompts.length)])
}

function createHistogram(data) {
    const canvas = d3n.createCanvas(960, 500);
    const context = canvas.getContext('2d');
    canvas.pngStream().pipe(fs.createWriteStream('output.png'));
}

const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'LaunchRequest';
    },
    handle(handlerInput) {
        console.info('application launched.');
        const speechText = 'Welcome to the ATLAS computing info system! ' + getRandReprompt();

        return handlerInput.responseBuilder
            .speak(speechText)
            .reprompt(getRandReprompt())
            .withSimpleCard('ATLAS computing', speechText)
            .getResponse();
    }
};

const SetUsernameIntentHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'SetUsername';
    },
    handle(handlerInput) {
        console.info('asked to set username.');

        const slots = handlerInput.requestEnvelope.request.intent.slots;
        console.info(JSON.stringify(slots, null, 4));

        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        sessionAttributes.my_username = slots.username.value;
        sessionAttributes.my_user_id = slots.username.resolutions.resolutionsPerAuthority[0].values[0].value.id.replace('^', ' ');
        handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

        const speechText = `Your username has been set to ${slots.username.value}.`;
        const repromptText = `To get your jobs, say "get my jobs."`;
        return handlerInput.responseBuilder
            .speak(speechText + getRandReprompt())
            .reprompt(repromptText)
            .withSimpleCard('ATLAS computing', speechText)
            .getResponse();
    }
};

const SetSiteIntentHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'SetSite';
    },
    handle(handlerInput) {
        console.info('asked to set site.');

        const slots = handlerInput.requestEnvelope.request.intent.slots;
        console.info(JSON.stringify(slots, null, 4));

        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        sessionAttributes.my_site = slots.sitename.value;
        sessionAttributes.my_site_id = slots.sitename.resolutions.resolutionsPerAuthority[0].values[0].value.id;
        handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

        const speechText = `Your site has been set to ${slots.sitename.value}.`;
        const repromptText = `To get jobs states at your site, say "get my site state."`;

        return handlerInput.responseBuilder
            .speak(speechText + getRandReprompt())
            .withSimpleCard('ATLAS computing', speechText)
            .reprompt(repromptText)
            .getResponse();
    }
};


const GetSiteStatusIntentHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'GetSiteStatus';
    },
    async handle(handlerInput) {
        console.info('asked for site status.');
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        if (sessionAttributes.my_site) {
            var speechText = `During last `;

            const slots = handlerInput.requestEnvelope.request.intent.slots;
            console.info(JSON.stringify(slots, null, 4));

            let start_in_utc = new Date().getTime() - 24 * 86400 * 1000;
            if (slots.interval.interval) {
                console.info('interval: ', slots.interval.value);
                const interval = intervalParser.toSeconds(intervalParser.parse(slots.interval.value));
                start_in_utc = new Date().getTime() - interval * 1000;
                speechText += slots.interval.value;
            }
            else {
                speechText += 'day';
            }

            const sbody = {
                index: 'jobs',
                body: {
                    size: 0,
                    query: {
                        bool: {
                            must: [
                                { wildcard: { computingsite: `*${sessionAttributes.my_site_id}*` } },
                                { range: { modificationtime: { gte: start_in_utc } } }
                            ],
                        }
                    },
                    aggs: {
                        all_statuses: {
                            terms: {
                                field: "jobstatus"
                            }
                        },
                        all_queues: {
                            terms: {
                                field: "computingsite"
                            }
                        }
                    }
                }
            }
            console.debug(JSON.stringify(sbody, null, 4));
            const es_resp = await es.search(sbody);
            console.debug('es response1:', es_resp.body.aggregations.all_statuses)
            console.debug('es response2:', es_resp.body.aggregations.all_queues)
            const sbuckets = es_resp.body.aggregations.all_statuses.buckets;


            var totjobs = 0;
            var details = 'Jobs are in following states:\n';
            for (i in sbuckets) {
                details += sbuckets[i].key + ' ' + sbuckets[i].doc_count.toString() + ',\n';
                totjobs += sbuckets[i].doc_count;
            }
            speechText += `,\nsite ${sessionAttributes.my_site},\nhad ${totjobs} jobs.\n`
            if (totjobs > 0) {
                speechText += details;
            }

            return handlerInput.responseBuilder
                .speak(speechText + getRandReprompt())
                .reprompt(getRandReprompt())
                .withSimpleCard('ATLAS computing - site status', speechText)
                .getResponse();
        } else {
            return handlerInput.responseBuilder
                .speak('You need to set site first. Try saying "set my site".')
                .reprompt('Please set your site.')
                .addElicitSlotDirective('sitename')
                .getResponse();
        }
    }
};

const JobsIntentHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'Jobs';
    },
    async handle(handlerInput) {
        const slots = handlerInput.requestEnvelope.request.intent.slots;
        console.info('asked for jobs information. slots:', slots);

        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();

        if (sessionAttributes.my_username) {
            var speechText = `During last `;

            let start_in_utc = new Date().getTime() - 7 * 24 * 86400 * 1000;

            if (slots.interval.interval) {
                const interval = intervalParser.toSeconds(intervalParser.parse(slots.interval.value));
                start_in_utc = new Date().getTime() - interval * 1000;
                speechText += slots.interval.value;
            }
            else {
                speechText += 'day';
            }

            const sbody = {
                index: 'jobs',
                body: {
                    size: 0,
                    query: {
                        bool: {
                            must: [
                                { match: { produsername: sessionAttributes.my_user_id } },
                                { range: { modificationtime: { gte: start_in_utc } } }
                            ],
                        }
                    },
                    aggs: {
                        all_statuses: {
                            terms: {
                                field: "jobstatus"
                            }
                        }
                    }
                }
            }
            console.debug(JSON.stringify(sbody, null, 4));
            const es_resp = await es.search(sbody);
            console.debug('es response:', es_resp.body.aggregations.all_statuses)
            const buckets = es_resp.body.aggregations.all_statuses.buckets;

            var totjobs = 0;
            var details = 'Jobs are in following states:\n';
            for (i in buckets) {
                details += buckets[i].key + ' ' + buckets[i].doc_count.toString() + ',\n';
                totjobs += buckets[i].doc_count;
            }
            speechText += `,\nuser ${sessionAttributes.my_username},\nhad ${totjobs} jobs.\n`
            if (totjobs > 0) {
                speechText += details;
            }

            console.info(speechText);
            return handlerInput.responseBuilder
                .speak(speechText + getRandReprompt())
                .reprompt(getRandReprompt())
                .withSimpleCard('ATLAS computing', speechText)
                .getResponse();
        } else {
            return handlerInput.responseBuilder
                .speak('You need to set your username first. Try saying "set my username".')
                .reprompt('Please set your username.')
                .addElicitSlotDirective('username')
                .getResponse();
        }
    }
};

const TasksIntentHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'Tasks';
    },
    async handle(handlerInput) {
        const slots = handlerInput.requestEnvelope.request.intent.slots;
        console.info('asked for tasks information. slots:', slots);

        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();

        if (sessionAttributes.my_username) {
            var speechText = `During last `;

            let start_in_utc = new Date().getTime() - 7 * 24 * 86400 * 1000;
            if (slots.interval.interval) {
                const interval = intervalParser.toSeconds(intervalParser.parse(slots.interval.value));
                start_in_utc = new Date().getTime() - interval * 1000;
                speechText += slots.interval.value;
            }
            else {
                speechText += '7 days';
            }

            const sbody = {
                index: 'tasks',
                body: {
                    size: 0,
                    query: {
                        bool: {
                            must: [
                                { match: { produsername: sessionAttributes.my_user_id } },
                                { range: { modificationtime: { gte: start_in_utc } } }
                            ],
                        }
                    },
                    aggs: {
                        all_statuses: {
                            terms: {
                                field: "status"
                            }
                        }
                    }
                }
            };

            const es_resp = await es.search(sbody);
            console.info('es response:', es_resp.body.aggregations.all_statuses)
            const buckets = es_resp.body.aggregations.all_statuses.buckets;
            var tottasks = 0;
            var details = 'Tasks are in following states:\n';
            for (i in buckets) {
                details += buckets[i].key + ' ' + buckets[i].doc_count.toString() + ',\n';
                tottasks += buckets[i].doc_count;
            }
            speechText += `,\nuser ${sessionAttributes.my_username},\nhad ${tottasks} tasks.\n`
            if (tottasks > 0) {
                speechText += details;
            }

            console.info(speechText);
            return handlerInput.responseBuilder
                .speak(speechText + getRandReprompt())
                .reprompt(getRandReprompt())
                .withSimpleCard('ATLAS computing', speechText)
                .getResponse();
        } else {
            return handlerInput.responseBuilder
                .speak('You need to set your username first. Try saying "set my username".')
                .reprompt('Please set your username.')
                .addElicitSlotDirective('username')
                .getResponse();
        }
    }
};

const DataIntentHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'Data';
    },
    handle(handlerInput) {
        console.info('asked for data information');
        const data_volume = humanFileSize(Math.random() * 1024 * 1024 * 1024 * 1024);
        const speechText = 'Currently you have ' + data_volume + ' in your datasets.';

        return handlerInput.responseBuilder
            .speak(speechText + getRandReprompt())
            .reprompt(getRandReprompt())
            .withSimpleCard('ATLAS computing', speechText)
            .getResponse();
    }
};

const TransfersIntentHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'Transfers';
    },
    handle(handlerInput) {
        console.info('asked for transfers information');
        const data_volume = humanFileSize(Math.random() * 1024 * 1024 * 1024);
        var speechText = data_volume + ' has been transfered.';
        speechText = humanFileSize(Math.random() * 1024 * 1024 * 1024) + ' remains is waiting in queue.';

        return handlerInput.responseBuilder
            .speak(speechText + getRandReprompt())
            .reprompt(getRandReprompt())
            .withSimpleCard('ATLAS computing', speechText)
            .getResponse();
    }
};


const SystemStatusIntentHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'SystemStatus';
    },
    async handle(handlerInput) {
        console.info('asked for system status.');
        console.info('slots:', handlerInput.requestEnvelope.request.intent.slots)
        const sistem = handlerInput.requestEnvelope.request.intent.slots.ADCsystem.value;

        if (sistem === 'elastic') {
            const es_resp = await es.cluster.health()
            console.info('es response:', es_resp.body)
            const es_status = es_resp.body.status;
            const es_unassigned = es_resp.body.unassigned_shard;
            let speechText = 'Elastic status is ' + es_status + '.';
            if (es_status !== 'green') {
                speechText += ' There are ' + es_unassigned.toString() + ' unassigned shards.';
            }
            console.info(speechText);
            return handlerInput.responseBuilder
                .speak(speechText + getRandReprompt())
                .reprompt(getRandReprompt())
                .withSimpleCard('ATLAS computing - Elastic', speechText)
                .getResponse();
        };

        if (sistem === 'fts') {
            let speechText = 'fts status lookup not yet implemented.';
            console.info(speechText);
            return handlerInput.responseBuilder
                .speak(speechText + getRandReprompt())
                .reprompt(getRandReprompt())
                .withSimpleCard('ATLAS computing - FTS ', speechText)
                .getResponse();
        };

        if (sistem === 'perfsonar') {
            const ps_indices = {
                'ps_meta': [24, 0, 0],
                'ps_owd': [1, 0, 0],
                'ps_packet_loss': [1, 0, 0],
                'ps_retransmits': [1, 0, 0],
                'ps_status': [1, 0, 0],
                'ps_throughput': [1, 0, 0],
                'ps_trace': [1, 0, 0]
            }
            const sub_end = new Date().getTime() - 9 * 86400 * 1000;

            for (ind in ps_indices) {
                console.info("Checking: ", ind);
                const tbin = ps_indices[ind][0];

                const ref_start = sub_end - tbin * 3 * 3600 * 1000;
                const ref_end = sub_end - tbin * 3600 * 1000;
                // console.info('reference interval:', ref_start, ' till ', ref_end);

                let types_query = {
                    query: {
                        bool: {
                            filter: {
                                range: { timestamp: { gt: ref_start, lte: ref_end } }
                            }
                        }
                    }
                }

                const es_res = await es.count({ index: ind, body: types_query })
                // console.info(es_res.body.count);
                ps_indices[ind][1] = es_res.body.count;

                types_query = {
                    query: {
                        bool: {
                            filter: {
                                range: { timestamp: { gt: ref_end, lte: sub_end } }
                            }
                        }
                    }
                }

                const es_res1 = await es.count({ index: ind, body: types_query })
                ps_indices[ind][2] = es_res1.body.count;
            }

            console.info(ps_indices);

            var issueFound = false;
            var speechText = 'Issues detected in perfsonar data indexing.';
            for (ind in ps_indices) {
                if (ps_indices[ind][1] < 10) continue;
                if (ps_indices[ind][2] < 10 || ps_indices[ind][2] / ps_indices[ind][1] < 0.25) {
                    issueFound = true;
                    speechText += ' Index ' + ind + ' now has ' + ps_indices[ind][2].toString();
                    speechText += ' documents, previously it had ' + (ps_indices[ind][1] / 2).toFixed(0) + '.';
                }
            }
            if (issueFound === false) {
                speechText = 'No issues with perfsonar data collection.';
            }
            console.info(speechText);

            return handlerInput.responseBuilder
                .speak(speechText + getRandReprompt())
                .reprompt(getRandReprompt())
                .withSimpleCard('ATLAS computing - Perfsonar', speechText)
                .getResponse();
        }

        if (sistem === 'frontier') {
            let speechText = 'frontier status lookup not yet implemented.';
            console.info(speechText);
            return handlerInput.responseBuilder
                .speak(speechText + getRandReprompt())
                .reprompt(getRandReprompt())
                .withSimpleCard('ATLAS computing - Frontier', speechText)
                .getResponse();
        }
    }
};

const CancelAndStopIntentHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && (handlerInput.requestEnvelope.request.intent.name === 'AMAZON.CancelIntent'
                || handlerInput.requestEnvelope.request.intent.name === 'AMAZON.StopIntent');
    },
    handle(handlerInput) {
        console.info('asked for stop.');
        const speechText = 'Goodbye!';

        return handlerInput.responseBuilder
            .speak(speechText)
            .withSimpleCard('ATLAS computing', speechText)
            .getResponse();
    }
};

const SessionEndedRequestHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'SessionEndedRequest';
    },
    handle(handlerInput) {
        console.info('session ended request.');
        //any cleanup logic goes here
        return handlerInput.responseBuilder.getResponse();
    }
};


app.intent('Default Welcome Intent', (conv) => {
    console.info('application launched.');
    const speechText = 'Welcome to the ATLAS computing info system! ' + getRandReprompt();
    conv.ask(speechText);
});

app.intent('SetUsername', (conv, { username }) => {
    console.info('asked to set username.');
    conv.user.storage.my_username = username;
    const speechText = `Your username has been set to ${username}.`;
    const repromptText = `To get your jobs, say "get my jobs."`
    conv.ask(speechText);
    conv.ask(repromptText);
});

app.intent('SetSite', (conv, { sitename }) => {
    console.info('asked to set site.');
    conv.user.storage.my_site = sitename;
    const speechText = `Your site has been set to ${sitename}.`;
    // const repromptText = `To get jobs states at your site, say "get my site state."`;
    conv.ask(speechText);
});

app.intent('GetSiteStatus', async (conv, { sitename, duration }) => {

    console.info('asked for site status.');
    console.info('conv.user.storage:', conv.user.storage);
    console.info('sitename:', sitename);

    if (sitename) {
        conv.user.storage.my_site = sitename;
    }

    if (conv.user.storage.my_site) {

        var speechText = `During last `;

        let start_in_utc = new Date().getTime() - 24 * 86400 * 1000;
        if (duration) {
            console.info('duration: ', duration);
            const interval = getDuration(duration);
            start_in_utc = new Date().getTime() - interval[0];
            speechText += duration.amount.toString() + ' ' + interval[1];
        }
        else {
            speechText += 'day';
        }

        const sbody = {
            index: 'jobs',
            body: {
                size: 0,
                query: {
                    bool: {
                        must: [
                            { wildcard: { computingsite: `*${conv.user.storage.my_site}*` } },
                            { range: { modificationtime: { gte: start_in_utc } } }
                        ],
                    }
                },
                aggs: {
                    all_statuses: {
                        terms: {
                            field: "jobstatus"
                        }
                    },
                    all_queues: {
                        terms: {
                            field: "computingsite"
                        }
                    }
                }
            }
        }
        console.debug(JSON.stringify(sbody, null, 4));
        const es_resp = await es.search(sbody);
        console.debug('es response1:', es_resp.body.aggregations.all_statuses)
        console.debug('es response2:', es_resp.body.aggregations.all_queues)
        const sbuckets = es_resp.body.aggregations.all_statuses.buckets;

        var totjobs = 0;
        var details = 'Jobs are in following states:\n';
        for (i in sbuckets) {
            details += sbuckets[i].key + ' ' + sbuckets[i].doc_count.toString() + ',\n';
            totjobs += sbuckets[i].doc_count;
        }
        speechText += `,\nsite ${conv.user.storage.my_site},\nhad ${totjobs} jobs.\n`
        if (totjobs > 0) {
            speechText += details;
        }

        conv.ask(speechText);
    }
    else {
        conv.ask('You need to set site first. Try saying "set my site".');
    }
});

app.intent('Jobs', async (conv, { duration }) => {
    console.info('asked for jobs.');
    console.info('conv.user.storage:', conv.user.storage);

    if (conv.user.storage.my_username) {

        var speechText = `During last `;

        let start_in_utc = new Date().getTime() - 24 * 86400 * 1000;
        if (duration) {
            console.info('duration: ', duration);
            const interval = getDuration(duration);
            start_in_utc = new Date().getTime() - interval[0];
            speechText += duration.amount.toString() + ' ' + interval[1];
        }
        else {
            speechText += 'day';
        }


        const sbody = {
            index: 'jobs',
            body: {
                size: 0,
                query: {
                    bool: {
                        must: [
                            { match: { produsername: conv.user.storage.my_username } },
                            { range: { modificationtime: { gte: start_in_utc } } }
                        ],
                    }
                },
                aggs: {
                    all_statuses: {
                        terms: {
                            field: "jobstatus"
                        }
                    }
                }
            }
        }
        console.debug(JSON.stringify(sbody, null, 4));
        const es_resp = await es.search(sbody);
        console.debug('es response:', es_resp.body.aggregations.all_statuses)
        const buckets = es_resp.body.aggregations.all_statuses.buckets;

        var totjobs = 0;
        var details = 'Jobs are in following states:\n';
        for (i in buckets) {
            details += buckets[i].key + ' ' + buckets[i].doc_count.toString() + ',\n';
            totjobs += buckets[i].doc_count;
        }
        speechText += `,\nuser ${conv.user.storage.my_username},\nhad ${totjobs} jobs.\n`
        if (totjobs > 0) {
            speechText += details;
        }

        console.info(speechText);
        conv.ask(speechText);
    }
    else {
        conv.ask('You need to set username first. Try saying "set my username".');
    }
});

app.intent('Tasks', async (conv, { duration }) => {
    console.info('asked for tasks.');
    console.info('conv.user.storage:', conv.user.storage);

    if (conv.user.storage.my_username) {

        var speechText = `During last `;

        let start_in_utc = new Date().getTime() - 7 * 24 * 86400 * 1000;
        if (duration) {
            console.info('duration: ', duration);
            const interval = getDuration(duration);
            start_in_utc = new Date().getTime() - interval[0];
            speechText += duration.amount.toString() + ' ' + interval[1];
        }
        else {
            speechText += '7 days';
        }


        const sbody = {
            index: 'tasks',
            body: {
                size: 0,
                query: {
                    bool: {
                        must: [
                            { match: { produsername: conv.user.storage.my_username } },
                            { range: { modificationtime: { gte: start_in_utc } } }
                        ],
                    }
                },
                aggs: {
                    all_statuses: {
                        terms: {
                            field: "status"
                        }
                    }
                }
            }
        };

        const es_resp = await es.search(sbody);
        console.info('es response:', es_resp.body.aggregations.all_statuses)
        const buckets = es_resp.body.aggregations.all_statuses.buckets;
        var tottasks = 0;
        var details = 'Tasks are in following states:\n';
        for (i in buckets) {
            details += buckets[i].key + ' ' + buckets[i].doc_count.toString() + ',\n';
            tottasks += buckets[i].doc_count;
        }
        speechText += `,\nuser ${conv.user.storage.my_username},\nhad ${tottasks} tasks.\n`
        if (tottasks > 0) {
            speechText += details;
        }

        console.info(speechText);
        conv.ask(speechText);
    }
    else {
        conv.ask('You need to set username first. Try saying "set my username".');
    }
});

app.intent('Data', (conv) => {
    console.info('asked for data information');
    const data_volume = humanFileSize(Math.random() * 1024 * 1024 * 1024 * 1024);
    const speechText = 'Currently you have ' + data_volume + ' in your datasets.';
    conv.ask(speechText);
});

app.intent('Transfers', (conv) => {
    console.info('asked for transfers information');
    const data_volume = humanFileSize(Math.random() * 1024 * 1024 * 1024);
    var speechText = data_volume + ' has been transfered.';
    speechText = humanFileSize(Math.random() * 1024 * 1024 * 1024) + ' remains is waiting in queue.';
    conv.ask(speechText);
});

app.intent('SystemStatus', async (conv, { ADC_system }) => {

    console.info('asked for status of:', ADC_system);

    if (ADC_system === 'Elastic') {
        const es_resp = await es.cluster.health()
        console.info('es response:', es_resp.body)
        const es_status = es_resp.body.status;
        const es_unassigned = es_resp.body.unassigned_shard;
        let speechText = 'Elastic status is ' + es_status + '.';
        if (es_status !== 'green') {
            speechText += ' There are ' + es_unassigned.toString() + ' unassigned shards.';
        }
        console.info(speechText);
        conv.ask(speechText);
    };

    if (ADC_system === 'FTS') {
        let speechText = 'fts status lookup not yet implemented.';
        console.info(speechText);
        conv.ask(speechText);
    };

    if (ADC_system === 'Perfsonar') {
        const ps_indices = {
            'ps_meta': [24, 0, 0],
            'ps_owd': [1, 0, 0],
            'ps_packet_loss': [1, 0, 0],
            'ps_retransmits': [1, 0, 0],
            'ps_status': [1, 0, 0],
            'ps_throughput': [1, 0, 0],
            'ps_trace': [1, 0, 0]
        }
        const sub_end = new Date().getTime() - 9 * 86400 * 1000;

        for (ind in ps_indices) {
            console.info("Checking: ", ind);
            const tbin = ps_indices[ind][0];

            const ref_start = sub_end - tbin * 3 * 3600 * 1000;
            const ref_end = sub_end - tbin * 3600 * 1000;
            // console.info('reference interval:', ref_start, ' till ', ref_end);

            let types_query = {
                query: {
                    bool: {
                        filter: {
                            range: { timestamp: { gt: ref_start, lte: ref_end } }
                        }
                    }
                }
            }

            const es_res = await es.count({ index: ind, body: types_query })
            // console.info(es_res.body.count);
            ps_indices[ind][1] = es_res.body.count;

            types_query = {
                query: {
                    bool: {
                        filter: {
                            range: { timestamp: { gt: ref_end, lte: sub_end } }
                        }
                    }
                }
            }

            const es_res1 = await es.count({ index: ind, body: types_query })
            ps_indices[ind][2] = es_res1.body.count;
        }

        console.info(ps_indices);

        var issueFound = false;
        var speechText = 'Issues detected in perfsonar data indexing.';
        for (ind in ps_indices) {
            if (ps_indices[ind][1] < 10) continue;
            if (ps_indices[ind][2] < 10 || ps_indices[ind][2] / ps_indices[ind][1] < 0.25) {
                issueFound = true;
                speechText += ' Index ' + ind + ' now has ' + ps_indices[ind][2].toString();
                speechText += ' documents, previously it had ' + (ps_indices[ind][1] / 2).toFixed(0) + '.';
            }
        }
        if (issueFound === false) {
            speechText = 'No issues with perfsonar data collection.';
        }
        console.info(speechText);
        conv.ask(speechText);
    }

    if (ADC_system === 'Frontier') {
        let speechText = 'Frontier status lookup not yet implemented.';
        console.info(speechText);
        conv.ask(speechText);
    }

});

app.fallback((conv) => {
    conv.ask(`I couldn't understand. Can you say that again?`);
});

app.catch((conv, error) => {
    console.error(error);
    conv.ask('I encountered a glitch. Can you say that again?');
});

expressApp.post('/fulfillment', app);

expressApp.get('/healthz', function (_req, res) {
    res.status(200).send('OK');
});

expressApp.listen(80);


async function main() {
    try {
        await es.ping(function (err, resp, status) {
            console.log('ES ping:', resp.statusCode);
        });
    } catch (err) {
        console.error('Error: ', err);
    }
}

main();
