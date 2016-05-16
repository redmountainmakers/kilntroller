var express = require('express'),
    serial  = require('serialport');

var app    = express(),
    status = { raw : {}, computed : {} },
    port,
    server;

function sendCommand(command, res) {
    port.write(command + '\r\n', function(err) {
        if (err) {
            res.status(500).send(err.message + '\n');
        } else {
            res.send('Command OK: ' + command + '\n');
        }
    });
}

app.get('/', function(req, res) {
    res.json(status);
});

app.post('/on', function(req, res) {
    sendCommand('ON', res);
});

app.post('/off', function(req, res) {
    sendCommand('OFF', res);
});

server = app.listen(3000, function() {
    console.log('listening on :3000');

    port = new serial.SerialPort('/dev/ttyACM0', {
        baudRate : 115200,
        parser   : serial.parsers.readline('\n')
    });

    port.on('open', function() {
        // Clear the command buffer
        port.write('\r\n\r\n', function(err) {
            if (err) throw err;
            console.log('serial port open');
        });
    });

    var isFirstLine = true;
    port.on('data', function(line) {
        if (!isFirstLine) {
            line = line.trim();
            process.stdout.write('rx: ' + line + '\n');
            var match = line.match(/^([A-Z0-9]+)=([0-9]+) /);
            if (match) {
                var name  = match[1],
                    value = +match[2];
                status.raw[name] = value;
                if (/^T/.test(name)) {
                    if (name in status.computed) {
                        status.computed[name] =
                            status.computed[name] * 4 / 5 +
                            value / 100 * 1 / 5;
                    } else {
                        status.computed[name] = value / 100;
                    }
                }
            }
        }
        isFirstLine = false;
    });

    process.on('SIGINT', function() {
        console.log();
        port.close(function(err) {
            if (err) throw err;
            console.log('serial port closed');
            server.close(function(err) {
                if (err) throw err;
                console.log('HTTP server closed');
            });
        });
    });
});
