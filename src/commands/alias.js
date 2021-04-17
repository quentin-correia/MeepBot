const database = require('../utils/database');
const getCommands = require('../utils/commands');
const commands = getCommands(__filename, 'help');

async function alias(msg, msgArgs) {
    const newCommand = msgArgs[0];
    if (msgArgs.length > 1) {
        if (commands[newCommand] || newCommand === 'help') {
            await msg.channel.send('You can not override a default command');
        } else if (newCommand.startsWith(database.get(msg.guild.id, 'settings.prefix'))) {
            await msg.channel.send('Command should not start with a prefix');
        } else {
            let command = msgArgs[1];
            let s = 2;
            if (!commands[command] && command !== 'help') {
                command = 'echo';
                s = 1;
            }
            const args = msgArgs.slice(s);

            const existed = database.has(msg.guild.id, `aliases.${newCommand}`)
            database.set(msg.guild.id, {
                command,
                args
            }, `aliases.${newCommand}`);
            await msg.channel.send(`Alias '${newCommand}' ${existed ? 'changed' : 'added'}!`);
        }
    } else {
        await msg.channel.send('Alias needs at least 2 commands');
    }
}

function help(prefix) {
    return '```apache\n' +
        `${prefix}alias [command_name] [command]\n` +
        `Examples:\n` +
        `\t${prefix}alias owo echo fuck my ass\n` +
        `\t${prefix}alias nice play https://www.youtube.com/watch?v=myax0WsTSWA\n` +
        '```';
}

function description() {
    return `Add an alias for a command`;
}

const aliasrm = {
    'function': async (msg, [alias]) => {
        if (alias) {
            const exists = database.has(msg.guild.id, `aliases.${alias}`)
            if (exists) {
                database.delete(msg.guild.id, `aliases.${alias}`);
                await msg.channel.send(`Removed \`${alias}\` from alias list`);
            } else {
                await msg.channel.send(`Could not find alias with name \`${alias}\``);
            }
        } else {
            await msg.channel.send('Second argument should contain an alias name');
        }
    },
    'description': () => {
        return 'Remove an alias'
    },
    'help': (prefix) => {
        return '```apache\n' +
            `${prefix}aliasrm [alias]\n` +
            `Examples:\n` +
            `\t${prefix}aliasrm owo\n` +
            `\t${prefix}aliasrm nice\n` +
            '```';
    },
    'group': 'misc'
}

module.exports = {
    'alias': {
        'function': alias,
        'description': description,
        'help': help,
        'group': 'misc'
    },
    aliasrm
};