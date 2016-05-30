var fs   = require('fs'),
    yaml = require('js-yaml'),
    path = require('path');

var config;

try {
    config = yaml.load(fs.readFileSync(
        path.join(__dirname, '..', 'data', 'config.yml'),
        'utf8'
    ));
} catch (err) {
    console.error(
        'Error reading config file: %s',
        err.message
    );
    process.exit(1);
}

module.exports = config;
