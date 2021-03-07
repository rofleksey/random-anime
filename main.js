#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const { exec } = require("child_process");

const axios = require('axios');
const HttpsProxyAgent = require('https-proxy-agent');

const rootUrl = 'https://twist.moe/';
const proxyUrl = 'http://34.92.50.186:3128';
const userAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/76.0.3809.46 Safari/537.36';
const proxyAgent = new HttpsProxyAgent(proxyUrl);
const instance = axios.create({
    baseURL: rootUrl,
    timeout: 30000,
    maxRedirects: 15,
    headers: {
        'User-Agent': userAgent,
        'X-Access-Token': '0df14814b9e590a1f26d3071a4ed7974'
    },
    httpsAgent: proxyAgent,
});

async function getAllTitles() {
    const response = await instance.get('/api/anime');
    return response.data;
}

async function getEpisodes(slug) {
    const response = await instance.get(`/api/anime/${slug}/sources`);
    return response.data;
}

function copyOfRange(source, from, to) {
    const length = to - from;
    const result = Buffer.allocUnsafe(length);
    source.copy(result, 0, from, to);
    return result;
}

function decryptAes(input, key, iv) {
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decoded = decipher.update(input, 'base64', 'utf-8');
    decoded += decipher.final('utf-8');
    return decoded;
}

function decodeSource(source) {
    const decoded = Buffer.from(source, 'base64');
    const salt = copyOfRange(decoded, 8, 16);
    const keyIv = bytesToKey(salt);
    const key = copyOfRange(keyIv, 0, 32);
    const iv = copyOfRange(keyIv, 32, keyIv.length);
    const decrypted = decryptAes(copyOfRange(decoded, 16, decoded.length), key, iv);
    return decrypted.toString('utf-8');
}

function md5(buf) {
    const str = crypto
        .createHash('md5')
        .update(buf)
        .digest('base64');
    return Buffer.from(str, 'base64');
}

function bytesToKey(salt) {
    let data = Buffer.from('267041df55ca2b36f2e322d05ee2c9cf', 'binary');
    const dataWithSalt = Buffer.concat([data, salt]);
    let key = md5(dataWithSalt);
    let finalKey = key;
    while(finalKey.length < 48) {
        key = md5(Buffer.concat([key, dataWithSalt]));
        finalKey = Buffer.concat([finalKey, key]);
    }
    return copyOfRange(finalKey, 0, 48);
}

async function launchExternal(cmd) {
    return new Promise((res, rej) => {
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                rej(error);
                return;
            }
            if (stderr) {
                console.log(stdout);
                console.error(stderr);
            }
            res();
        });
    })
}

async function downloadFile(url) {
    console.log('Starting download...')
    const {data, headers} = await axios.get(url, {
        responseType: 'stream',
        timeout: 30000,
        headers: {
            'User-Agent': userAgent,
            'Referer': rootUrl
        },
        httpsAgent: proxyAgent,
    });
    // const totalLength = headers['content-length']
    const writer = fs.createWriteStream('video.mp4');
    return new Promise((res, rej) => {
        data
            .on('error', rej)
            .on('end', res)
            .pipe(writer)
    });
}

async function delay(time) {
    return new Promise((res) => {
        setTimeout(res, time);
    })
}

async function main() {
    while (true) {
        try {
            console.log('Getting list of anime titles...');
            const titles = await getAllTitles();
            const curAnime = titles[Math.floor(titles.length * Math.random())];
            const name = curAnime.title;
            console.log(`Picked '${name}'`);
            const slug = curAnime.slug.slug;
            const episodes = await getEpisodes(slug);
            const curEpisode = episodes[Math.floor(episodes.length * Math.random())];
            const episodeNum = curEpisode.number;
            console.log(`Picked episode #${episodeNum}`);
            const source = curEpisode.source;
            const decodedSource = decodeSource(source);
            const realSource = `https://cdn.twist.moe${decodedSource}`
            console.log(realSource);
            await launchExternal(`wget -O video.mp4 --user-agent "${userAgent}" --referer "${rootUrl}" "${realSource}"`);
            console.log('Launching video...');
            await launchExternal(`ffplay -fs -autoexit video.mp4`);
            console.log('OK!');
        } catch (e) {
            if (e.response) {
                console.error(e.response.data);
                console.error(e.response.status);
                console.error(e.response.headers);
            } else if (e.message) {
                console.error(`Error: ${e.message}`);
            } else {
                console.error(e);
            }
            await delay(10000);
        }
    }
}

process.on('exit', code => {
    console.log(`Exiting with code ${code}`);
});

process.on('SIGTERM', signal => {
    console.error(`Process received a SIGTERM signal`);
    process.exit(0);
});

process.on('SIGINT', signal => {
    console.error(`Process has been interrupted`);
    process.exit(0);
});

process.on('uncaughtException', err => {
    console.error(`Uncaught exception: ${err.message}`);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at ', promise, `reason: ${reason}`);
    process.exit(1);
});

main()
    .then(() => console.log('WTF'))
    .catch((e) => console.error(e));