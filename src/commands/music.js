// noinspection JSUnusedGlobalSymbols

const {scClientID} = require('../utils/config');
const ytdl = require('ytdl-core');
const ytpl = require('ytpl');
const sfdl = require('../utils/sfdl');
const scdl = require('soundcloud-downloader').default;
const client = require('../utils/client');
const {MessageEmbed} = require('discord.js');
const database = require('../utils/database');
const connections = {};

client.on('voiceStateUpdate', (oldMember, newMember) => {
    if (oldMember.channel && !newMember.channel) {
        if (oldMember.id === client.user.id) {
            const connection = connections[oldMember.guild.id];
            if (connection) {
                connection.disconnect();
            }
            console.log('[VC] Left');
        }
    } else if (!oldMember.channel && newMember.channel) {
        if (newMember.id === client.user.id) {
            console.log('[VC] Joined');
        }
    }
});

function shouldPlay(connection) {
    return !connection.dispatcher;
}

function updateDatabase(queue, guildId) {
    database.set(guildId, queue, 'music.queue');
}

function secondsToTime(seconds) {
    const hours = Math.floor(seconds / 3600).toString();
    const minutes = Math.floor(seconds / 60 % 60).toString();
    const seconds2 = Math.max(0, seconds % 60 - 1).toString();
    return (hours === '0' ? '' : hours.padStart(2, '0') + ':') + minutes.padStart(2, '0') + ':' + seconds2.padStart(2, '0');
}

function msToSeconds(ms) {
    return Math.floor(Math.max(0, ms / 1000));
}

function timeToSeconds(time) {
    if (!time || time === '') return 0;
    const split = time.split(':');
    let hours = 0;
    let minutes;
    let seconds;
    if (split.length === 3) {
        const [h, m, s] = split;
        hours = +h;
        minutes = +m;
        seconds = +s;
    } else {
        const [m, s] = split;
        minutes = +m;
        seconds = +s;
    }
    return (hours * 3600) + (minutes * 60) + seconds;
}

function filter(reaction, user) {
    return ['⬅️', '➡️'].includes(reaction.emoji.name) && !user.bot;
}

function replaceAt(string, index, replacement) {
    return string.substr(0, index) + replacement + string.substr(index + replacement.length);
}

async function nextSong(guildId, queue) {
    const connection = connections[guildId];
    if (queue.songs.length !== 0) {
        const song = queue.songs[0];
        if (song.url.startsWith('https://soundcloud.com')) {
            connection.play(await scdl.download(song.url, scClientID), {seek: song.seek});
        } else {
            connection.play(ytdl(song.url), {seek: song.seek});
        }
        song.pauseTime = -((song.seek * 1000) || 0);
        connection.dispatcher.on('finish', () => {
            switch (queue.repeat) {
                case 0:
                    queue.songs.shift();
                    break;
                case 1:
                    queue.songs.push(queue.songs.shift());
                    break;
            }
            nextSong(guildId, queue);
        });
        connection.dispatcher.on('error', console.log);
        updateDatabase(queue, guildId);
    }
}

const play = {
    'function': async function play(msg, args) {
        if (!msg.member.voice.channel) {
            await msg.channel.send('Join a voice channel first');
        } else {
            // Get queue
            const queue = database.get(msg.guild.id, 'music.queue');

            // Join if not already joined
            let connection = connections[msg.guild.id] || msg.guild.voice ? msg.guild.connection : undefined;
            if (!connection) {
                connection = await msg.member.voice.channel.join();
            }
            connections[msg.guild.id] = connection;

            // Play song
            const url = args[0];
            if (url) {
                if (url.startsWith('https://open.spotify.com/')) {
                    try {
                        const onTrackNotFound = (track) => {
                            msg.channel.send('Could not find a youtube equivalent of ' + track.name);
                        };

                        let progress;
                        const onProgress = async (at, from) => {
                            const embed = new MessageEmbed()
                                .setTitle('progress')
                                .setColor('#bfff00')
                                .setDescription(`${at} / ${from} \`${100 / from * at}%\``);
                            if (!progress) {
                                progress = await msg.channel.send(embed);
                            } else {
                                await progress.edit(embed);
                            }
                        };

                        const {songs, song} = await sfdl.get(url, onTrackNotFound, onProgress);
                        if (progress) {
                            await progress.delete();
                        }
                        const sp = shouldPlay(connection);

                        if (songs) {
                            queue.songs.push(...songs);
                            await msg.channel.send(`Added **${songs.length}** items to the queue`);
                        } else if (song) {
                            queue.songs.push(song);
                            if (!sp) {
                                await msg.channel.send(`Added \`${song.title}\` to the queue`);
                            }
                        }

                        if (sp) {
                            await nextSong(msg.guild.id, queue);
                            await msg.channel.send(`Now playing \`${queue.songs[0].title}\``);
                        }
                    } catch (err) {
                        console.log(err);
                        await msg.channel.send(err.message);
                    }
                } else if (url.startsWith('https://soundcloud.com')) {
                    try {
                        const info = await scdl.getInfo(url, scClientID);
                        const song = {
                            title: info.title,
                            url: info.permalink_url,
                            duration: secondsToTime(Math.round(info.full_duration / 1000)),
                            durationSeconds: Math.round(info.full_duration / 1000),
                            thumbnail: info.artwork_url
                        };
                        queue.songs.push(song);

                        if (shouldPlay(connection)) {
                            await nextSong(msg.guild.id, queue);
                            await msg.channel.send(`Now playing \`${queue.songs[0].title}\``);
                        } else {
                            await msg.channel.send(`Added \`${song.title}\` to the queue`);
                        }
                    } catch (err) {
                        await msg.channel.send(err.message);
                    }
                } else if (url.startsWith('https://www.youtube.com/playlist?list=')) {
                    const playlist = await ytpl(url);
                    const songs = playlist.items.map(({title, url, isLive, duration, bestThumbnail}) => {
                        return {
                            title,
                            url,
                            isLive,
                            duration,
                            durationSeconds: timeToSeconds(duration),
                            thumbnail: bestThumbnail.url
                        };
                    });
                    queue.songs.push(...songs);
                    await msg.channel.send(`Added **${songs.length}** items to the queue`);
                    if (shouldPlay(connection)) {
                        await nextSong(msg.guild.id, queue);
                        await msg.channel.send(`Now playing \`${queue.songs[0].title}\``);
                    }
                } else if (url.startsWith('https://www.youtube.com/watch?v=')) {
                    if (url.includes('list=')) {
                        await msg.channel.send('Mixes aren\'t supported');
                    }

                    const info = await ytdl.getInfo(url);
                    const song = {
                        title: info.videoDetails.title,
                        url: info.videoDetails.video_url,
                        isLive: info.videoDetails.isLiveContent,
                        duration: secondsToTime(info.videoDetails.lengthSeconds),
                        durationSeconds: info.videoDetails.lengthSeconds,
                        thumbnail: info.videoDetails.thumbnails[0].url
                    };
                    queue.songs.push(song);
                    if (shouldPlay(connection)) {
                        await nextSong(msg.guild.id, queue);
                        await msg.channel.send(`Now playing \`${queue.songs[0].title}\``);
                    } else {
                        await msg.channel.send(`Added \`${song.title}\` to the queue`);
                    }
                } else if (/^https?:\/\/(www)?.*/.test(url)) {
                    return msg.channel.send(`This platform isn't supported (yet)`);
                } else {
                    const song = await sfdl.searchYT(args.join(' '));
                    if (song) {
                        queue.songs.push(song);
                        if (shouldPlay(connection)) {
                            await nextSong(msg.guild.id, queue);
                            await msg.channel.send(`Now playing \`${queue.songs[0].title}\``);
                        } else {
                            await msg.channel.send(`Added \`${song.title}\` to the queue`);
                        }
                    } else {
                        await msg.channel.send('No search results');
                    }
                    return;
                }
            } else if (queue.songs.length !== 0) {
                await nextSong(msg.guild.id, queue);
            } else {
                await msg.channel.send(new MessageEmbed().setDescription('The queue is `empty`'));
            }

            if (/^https?:\/\/(www)?.*/.test(url)) {
                args.shift();
                const next = args[0];
                if (/^https?:\/\/(www)?.*/.test(next)) {
                    await play(msg, args);
                }
            }
        }
    },
    description: () => 'Play a song from youtube',
    help: (prefix) => `eg: \`${prefix}play https://www.youtube.com/watch?v=uKxyLmbOc0Q\``
};

const stop = {
    'function': async (msg) => {
        const connection = connections[msg.guild.id];
        if (connection) {
            const queue = database.get(msg.guild.id, 'music.queue');
            const song = queue.songs[0];
            if (connection.dispatcher && !connection.dispatcher.paused && song) {
                const pauseTime = connection.dispatcher.paused ? Date.now() - connection.dispatcher.pausedSince + song.pauseTime : song.pauseTime;
                song.seek = msToSeconds(Date.now() - connection.dispatcher.startTime - pauseTime);
                console.log(song.seek);
                updateDatabase(queue, msg.guild.id);
            }
            connection.disconnect();
            await msg.channel.send('Disconnected');
        } else {
            await msg.channel.send('I\'m not in a voice channel :/');
        }
    },
    description: () => 'Disconnect bot',
    help: (prefix) => `eg: \`${prefix}stop\``
};

const skip = {
    'function': async (msg, args) => {
        const queue = database.get(msg.guild.id, 'music.queue');
        const connection = connections[msg.guild.id];

        if (connection && connection.dispatcher) {
            connection.dispatcher.destroy();
            const to = args ? +args[0] - 1 || 1 : 1;
            queue.songs = queue.songs.slice(to);
            await nextSong(msg.guild.id, queue);
        } else {
            await msg.channel.send('Nothing to skip');
        }
    },
    description: () => 'Skip a song',
    help: (prefix) => `eg: \`${prefix}skip [(optional) item_id to skip to]\``
};

const pause = {
    'function': async (msg) => {
        const connection = connections[msg.guild.id];
        const queue = database.get(msg.guild.id, 'music.queue');
        if (queue.songs.length !== 0) {
            if (connection && connection.dispatcher) {
                if (!connection.dispatcher.paused) {
                    const song = queue.songs[0];
                    if (song) {
                        const pauseTime = connection.dispatcher.paused ? Date.now() - connection.dispatcher.pausedSince + song.pauseTime : song.pauseTime;
                        song.seek = msToSeconds(Date.now() - connection.dispatcher.startTime - pauseTime);
                        updateDatabase(queue, msg.guild.id);
                        console.log(song.seek);
                    }

                    connection.dispatcher.pause(true);
                    await msg.channel.send('Paused');
                } else {
                    await msg.channel.send('Already paused!');
                }
            } else {
                await msg.channel.send('Not playing any songs');
            }
        } else {
            await msg.channel.send('No queue');
        }
    },
    description: () => 'Pause song',
    help: (prefix) => `eg: \`${prefix}pause\``
};

const resume = {
    'function': async (msg) => {
        const connection = connections[msg.guild.id];
        const queue = database.get(msg.guild.id, 'music.queue');
        if (queue.songs.length !== 0) {
            if (!connection || !connection.dispatcher) {
                await play.function(msg, []);
            } else if (connection.dispatcher.paused) {
                const song = queue.songs[0];
                song.pauseTime += Math.abs(Date.now() - connection.dispatcher.pausedSince);
                connection.dispatcher.resume();
                await msg.channel.send('Resuming...');
            } else {
                await msg.channel.send('Not paused');
            }
        } else {
            await msg.channel.send('No queue');
        }
    },
    description: () => 'Resume song',
    help: (prefix) => `eg: \`${prefix}resume\``
};

const queue = {
    'function': async (msg) => {
        const queue = database.get(msg.guild.id, 'music.queue');
        if (queue.songs.length !== 0) {
            const perPage = 20;
            const pages = queue.songs.length / perPage;
            let page = 0;

            let navigating = true;
            let send = true;
            while (navigating) {
                let prettyQueue = '```haskell\n';
                prettyQueue += `total: ${queue.songs.length}\n\n`;
                let i = 0;
                const songs = queue.songs.slice(page * perPage, (page + 1) * perPage);
                for (const song of songs) {
                    prettyQueue += `${(i++ + 1) + (page * perPage)}) ${song.duration} ${song.title}\n`;
                }
                prettyQueue += '```';

                if (send) {
                    send = false;
                    msg = await msg.channel.send(prettyQueue);
                } else {
                    await msg.edit(prettyQueue);
                    await msg.reactions.removeAll();
                }
                if (page !== 0) await msg.react('⬅️');
                if (page < pages - 1) await msg.react('➡️');
                try {
                    const collected = await msg.awaitReactions(filter, {max: 1, time: 300000, errors: ['time']});
                    const reaction = collected.first();
                    if (reaction.emoji.name === '➡️') {
                        ++page;
                    } else {
                        --page;
                    }
                } catch (err) {
                    await msg.reactions.removeAll();
                    navigating = false;
                }
            }
        } else {
            await msg.channel.send(new MessageEmbed().setDescription('The queue is `empty`'));
        }
    },
    description: () => 'Song queue',
    help: (prefix) => `\`${prefix}queue\` -> Get queue`
};

const remove = {
    'function': async (msg, [item]) => {
        if (item) {
            const connection = connections[msg.guild.id];
            const queue = database.get(msg.guild.id, 'music.queue');
            if (queue.songs.length > 0) {
                if (item === 'all') {
                    queue.songs = [];
                    if (connection && connection.dispatcher) {
                        connection.dispatcher.destroy();
                        updateDatabase(queue, msg.guild.id);
                    }
                    await msg.channel.send('Cleared queue!');
                } else if (!isNaN(+item)) {
                    item = +item - 1;
                    if (item < 0 || item > queue.songs.length) {
                        await msg.channel.send('Invalid item id');
                    } else {
                        let deleted;
                        if (item === 0) {
                            deleted = [{...queue.songs[0]}];
                            if (queue.songs.length > 1) {
                                await skip.function(msg);
                            } else {
                                connection.dispatcher.destroy();
                                queue.songs = [];
                            }
                        } else {
                            deleted = queue.songs.splice(item, 1);
                        }
                        await msg.channel.send(`Removed \`${deleted[0].title}\` from the queue`);
                        updateDatabase(queue, msg.guild.id);
                    }
                } else {
                    await msg.channel.send('Invalid item id');
                }
            } else {
                await msg.channel.send(new MessageEmbed().setDescription('The queue is `empty`'));
            }
        } else {
            await msg.channel.send('No item id given');
        }
    },
    description: () => 'Remove a song from queue',
    help: (prefix) => {
        return `${prefix}remove <item_id>\n` +
            `\`${prefix}remove 2\` -> Remove item 2\n` +
            `\`${prefix}remove all\` -> Same as \`${prefix}clear\`\n`;
    }
};

const clear = {
    'function': async (msg) => {
        await remove.function(msg, ['all']);
    },
    description: () => 'Clear queue',
    help: (prefix) => `\`${prefix}clear\` -> Clear the queue`
};

const now = {
    'function': async (msg) => {
        const connection = connections[msg.guild.id];
        const queue = database.get(msg.guild.id, 'music.queue');
        if (connection && connection.dispatcher) {
            const song = queue.songs[0];

            const pauseTime = connection.dispatcher.paused ? Date.now() - connection.dispatcher.pausedSince + song.pauseTime : song.pauseTime;
            const playSeconds = msToSeconds(Date.now() - connection.dispatcher.startTime - pauseTime);
            const playTime = secondsToTime(playSeconds || 0);
            const length = 20;
            const progress = Math.round(length / 100 * (100 / song.durationSeconds * playSeconds));
            const progressBar = song.isLive ? '' : replaceAt('─'.repeat(length), progress, '⚪');
            const embed = new MessageEmbed()
                .setTitle(song.title)
                .setThumbnail(song.thumbnail)
                .addField(connection.dispatcher.paused ? 'Paused' : 'Playing', `${progressBar}  ${playTime} / ${song.isLive ? 'Live' : song.duration}`);
            await msg.channel.send(embed);
        } else {
            await msg.channel.send('Not playing any song');
        }
    },
    description: () => 'Get the currently playing song',
    help: (prefix) => `eg: \`${prefix}now\``
};

const repeat = {
    'function': async (msg) => {
        const queue = database.get(msg.guild.id, 'music.queue');
        queue.repeat = (queue.repeat + 1) % 3;
        switch (queue.repeat) {
            case 0:
                return msg.channel.send(new MessageEmbed().setDescription('Looping is `disabled`'));
            case 1:
                return msg.channel.send(new MessageEmbed().setDescription('Looping `the queue`'));
            case 2:
                return msg.channel.send(new MessageEmbed().setDescription('Looping `song`'));
        }
    },
    description: () => 'Repeat the song or queue',
    help: (prefix) => `eg: \`${prefix}repeat\``
};

const shuffle = {
    'function': async (msg) => {
        const queue = database.get(msg.guild.id, 'music.queue');
        const first = queue.songs.shift();
        const songs = queue.songs;
        for (let i = 0; i < 1000; i++) {
            const rand1 = Math.floor(Math.random() * songs.length);
            const rand2 = Math.floor(Math.random() * songs.length);
            const tmp = songs[rand1];
            songs[rand1] = songs[rand2];
            songs[rand2] = tmp;
        }
        queue.songs.unshift(first);
        await msg.channel.send('Queue shuffled!');
    },
    description: () => 'Shuffle the queue',
    help: (prefix) => `eg: \`${prefix}shuffle\``
};

const playlist = {
    'function': async (msg, [command, name]) => {
        const music = database.get(msg.guild.id, 'music');
        if (command && name) {
            const playlist = music.playlists[name];
            switch (command) {
                case 'load':
                case 'l':
                    if (playlist) {
                        await clear.function(msg);
                        database.set(msg.guild.id, playlist, 'music.queue');
                        await play.function(msg, []);
                    } else {
                        await msg.channel.send(`Playlist with the name ${name} does not exists`);
                    }
                    break;
                case 'save':
                case 's':
                    if (music.queue.songs.length !== 0) {
                        if (playlist) {
                            await msg.channel.send(`A playlist with the name ${name} already exists`);
                        } else {
                            music.queue.songs[0].seek = 0;
                            database.set(msg.guild.id, music.queue, 'music.playlists.' + name);
                            await msg.channel.send(`Playlist '${name}' with **${music.queue.songs.length}** songs saved!`);
                        }
                    } else {
                        await msg.channel.send(`Queue is empty so it would be useless to save this to a playlist`);
                    }
                    break;
                case 'rm':
                case 'remove':
                    if (playlist) {
                        await clear.function(msg);
                        database.set(msg.guild.id, playlist, 'music.queue');
                        await play.function(msg, []);
                    } else {
                        await msg.channel.send(`Playlist with the name ${name} does not exists`);
                    }
                    break;
            }
        } else {
            const fields = [];
            Object.entries(music.playlists)
                .forEach(([name, list]) => {
                    const size = list.songs.length;
                    fields.push({name: name, value: `${size} song${size !== 1 ? 's' : ''}`, inline: true});
                });

            const embed = new MessageEmbed()
                .setTitle('playlists')
                .addFields(...fields);

            await msg.channel.send(embed);
        }
    },
    description: () => 'Music playlist management',
    help: (prefix) => `eg: \`${prefix}playlist\``
};

module.exports = {
    'play': {
        ...play,
        'group': 'music',
    },
    'stop': {
        ...stop,
        'group': 'music',
    },
    'skip': {
        ...skip,
        'group': 'music',
    },
    'pause': {
        ...pause,
        'group': 'music',
    },
    'resume': {
        ...resume,
        'group': 'music',
    },
    'queue': {
        ...queue,
        'group': 'music',
    },
    'clear': {
        ...clear,
        'group': 'music',
    },
    'remove': {
        ...remove,
        'group': 'music',
    },
    'now': {
        ...now,
        'group': 'music',
    },
    'repeat': {
        ...repeat,
        'group': 'music',
    },
    'shuffle': {
        ...shuffle,
        'group': 'music',
    },
    'playlist': {
        ...playlist,
        'group': 'music',
    },
};

process.on('exit', (code) => {
    if (code === 0) {
        for (const connection of Object.values(connections)) {
            connection.disconnect();
        }
    }

    return console.log(`Exiting with code ${code}`);
});

process.on('SIGINT', () => {
    process.exit();
});