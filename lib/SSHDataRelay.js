var cp     = require('child_process'),
    events = require('events'),
    split  = require('split'),
    util   = require('util');

function SSHDataRelay(settings, controller, scheduler) {
    var self = this;

    if (!(self instanceof SSHDataRelay)) {
        return new SSHDataRelay(settings, controller);
    }

    self.controller = controller;
    self.scheduler  = scheduler;
    self.settings   = settings;
    self.status     = {};

    self._boundRecord        = self._record.bind(self);
    self._boundStoreSchedule = self._store.bind(self, 'schedule');

    self.connect();
}

util.inherits(SSHDataRelay, events.EventEmitter);

SSHDataRelay.prototype.connect = function() {
    var self = this;

    if (self.worker) {
        return;
    }

    var args = [];
    args.push('-i');
    args.push(self.settings.identityFile);
    args.push(self.settings.user + '@' + self.settings.hostname);
    args.push(self.settings.nodePath || 'node');
    args.push(self.settings.intakePath);

    self.worker = cp.spawn('ssh', args);

    self.worker.stdout.pipe(split())
        .on('data', function(line) {
            if (line === 'ready') {
                // When the controller sends an update, relay it immediately
                self.controller.on('update', self._boundRecord);
                // Store scheduler updates until the next controller update
                self.scheduler.on('update', self._boundStoreSchedule);
                // Send current schedule now
                self.scheduler.sendUpdate();
            }
            if (line) {
                self.emit('log', 'ssh: ' + line);
            }
        });

    self.worker.stderr.pipe(split())
        .on('data', function(line) {
            if (line) {
                self.emit('log', 'ssh stderr: ' + line);
            }
        });

    self.worker.on('close', function() {
        self.emit('log', 'ssh process closed');
        self.worker = null;
        self._removeListeners();
        if (!self.closed) {
            self.emit('log', 'ssh reconnecting');
            self.connect();
        }
    });
};

SSHDataRelay.prototype.close = function(cb) {
    var self = this;

    self._removeListeners();
    self.closed = true;

    if (self.worker) {
        self.worker.kill();
        self.worker = null;
    }
};

SSHDataRelay.prototype._record = function(data, sendImmediately) {
    var self = this;

    for (var k in data) {
        self.status[k] = data[k];
    }

    if (sendImmediately === false) {
        return;
    }

    if (self.worker) {
        try {
            self.worker.stdin.write(JSON.stringify(self.status) + "\n");
        } catch (err) {
            // This might fail if the process is closing
        }
    }
};

SSHDataRelay.prototype._store = function(key, value) {
    var self = this;

    var data = {};
    data[key] = value;
    self._record(data, false);
};

SSHDataRelay.prototype._removeListeners = function() {
    var self = this;

    self.controller.removeListener('update', self._boundRecord);
    self.scheduler.removeListener('update', self._boundStoreSchedule);
};

module.exports = SSHDataRelay;
