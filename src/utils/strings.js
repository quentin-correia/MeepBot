const fs = require('fs');
const parser = require('xml2json');
const database = require('./database');

function missingNames(locales) {
    let first;
    const missing = {};
    const names = [];
    // names    [o, w, s]
    // strings  [o, w]
    Object.entries(locales).forEach(([locale, strings]) => {
        if (!first) first = locale;
        if (first !== locale) {
            names.forEach(n => {
                if (!Object.keys(strings).find((name) => name === n)) {
                    if (!missing[locale]) {
                        missing[locale] = [];
                    }
                    missing[locale].push(n);
                    locales[locale][n] = locales[first][n];
                }
            });
        }
        Object.entries(strings).forEach(([name]) => {
            if (first === locale) {
                names.push(name);
            } else if (!names.includes(name)) {
                if (!missing[first]) {
                    missing[first] = [];
                }
                missing[first].push(name);
                names.push(name);
            }
        });
    });
    return missing;
}

const strings = function (stringPath) {
    const locales = {};

    const dir = fs.readdirSync(stringPath);
    for (const locale of dir) {
        const xml = fs.readFileSync(`${stringPath}/${locale}`);
        // noinspection JSCheckFunctionSignatures,JSUnresolvedVariable
        const resources = JSON.parse(parser.toJson(xml)).resources;
        const strings = {};
        if (Array.isArray(resources.string)) {
            for (const str of resources.string) {
                // (?=[ \W])(?<!\w)|\n(?=\n)
                // |\n(?=\n)
                strings[str.name] = (str['$t'] || '').replace(/ {7,8}/g, '');
            }
        } else {
            strings[resources.string.name] = resources.string['$t'];
        }

        locales[locale.replace('.xml', '')] = strings;
    }

    // Check for missing
    const missing = missingNames(locales);
    if (Object.keys(missing).length > 0) {
        console.error(missing);
    }

    function getString(guildId, stringName) {
        const locale = database.get(guildId, 'settings.language');
        let strings = locales[locale];
        if (!strings) {
            database.set(guildId, 'english', 'settings.language');
            strings = locales['english'];
        }
        return strings[stringName];
    }

    return {
        find(locale) {
            return Object.keys(locales).find(loc => loc.startsWith(locale));
        },
        languages: Object.keys(locales),
        getString,
        getGetString(guildId) {
            return (key) => getString(guildId, key);
        }
    };
};

module.exports = strings('./src/assets/strings');