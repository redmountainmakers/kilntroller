var events = require('events'),
    moment = require('moment'),
    util   = require('util');

function Scheduler(settings, controller) {
    var self = this;

    if (!(self instanceof Scheduler)) {
        return new Scheduler(settings, controller);
    }

    self.settings   = settings;
    self.controller = controller;
    self.schedule   = null;
    self.status     = null;

    self._boundUpdate = self.update.bind(self);
}

util.inherits(Scheduler, events.EventEmitter);

Scheduler.prototype.getStatus = function() {
    var self = this;

    if (self.schedule) {
        return {
            steps : {
                previous : self.schedule.slice(0, self.status.stepIndex),
                current  : self.schedule[self.status.stepIndex] || null,
                future   : self.schedule.slice(self.status.stepIndex + 1),
            },
            startedAt     : self.status.startedAt,
            stepStartedAt : self.status.stepStartedAt,
            now           : +moment.utc()
        };
    } else {
        return null;
    }
};

Scheduler.prototype.setSchedule = function(schedule) {
    var self = this;

    schedule = self.validateSchedule(schedule);

    if (self.schedule) {
        self.clearSchedule();
    }

    self.schedule = schedule;
    self.status = {
        startedAt     : +moment.utc(),
        stepIndex     : 0,
        stepStartedAt : +moment.utc(),
        interval      : setInterval(self.update.bind(self), 1000)
    };
    self.update();
};

Scheduler.prototype.update = function() {
    var self = this;

    var desiredTemperature = null,
        step               = self.schedule[self.status.stepIndex],
        minutesThisStep    = (moment.utc() - self.status.stepStartedAt) / 1000 / 60;

    if (minutesThisStep < step.rampMinutes) {
        // Ramp
        var previousTemperature = (
            self.status.stepIndex > 0
                ? self.schedule[self.status.stepIndex - 1].temperature
                : self.settings.minTemperature
        );
        desiredTemperature = (
            previousTemperature +
            (step.temperature - previousTemperature) * (minutesThisStep / step.rampMinutes)
        );
    } else if (minutesThisStep < step.rampMinutes + step.soakMinutes) {
        // Soak
        desiredTemperature = step.temperature;
    } else {
        // End of this step
        if (self.status.stepIndex === self.schedule.length - 1) {
            // This is the end of the schedule
            self.controller.setTargetTemperature(0);
            // Send an update with all steps in the 'previous' bucket
            self.status.stepIndex++;
            self.emit('update', self.getStatus());
            // Clear the schedule and return
            self.clearSchedule();
            return;
        } else {
            // Advance to the next step
            self.status.stepIndex++;
            self.status.stepStartedAt = +moment.utc();
            self.update();
        }
    }

    if (desiredTemperature !== null) {
        var currentTemperature = self.controller.getTargetTemperature();
        if (currentTemperature !== desiredTemperature) {
            self.controller.setTargetTemperature(desiredTemperature);
        }
    }

    self.emit('update', self.getStatus());
};

Scheduler.prototype.clearSchedule = function() {
    var self = this;

    if (self.schedule) {
        self.schedule = null;
        clearInterval(self.status.interval);
        self.status = null;
    }
};

Scheduler.prototype.validateSchedule = function(schedule) {
    var self = this;

    schedule = JSON.parse(JSON.stringify(schedule));

    if (!Array.isArray(schedule)) {
        throw new Error('Schedule must be an array');
    }

    if (!schedule.length) {
        throw new Error('Schedule must have at least one step');
    }

    schedule.forEach(function(step) {
        if (
            typeof step.temperature !== 'number' ||
            schedule.temperature < self.settings.minTemperature ||
            schedule.temperature > self.settings.maxTemperature
        ) {
            throw new Error(util.format(
                'Step temperature must be a number between %d and %d',
                self.settings.minTemperature,
                self.settings.maxTemperature
            ));
        }

        if (typeof step.rampMinutes === 'undefined') {
            step.rampMinutes = 0;
        }
        if (
            typeof step.rampMinutes !== 'number' ||
            step.rampMinutes < 0
        ) {
            throw new Error('Step ramp time must be a non-negative number');
        }

        if (typeof step.soakMinutes === 'undefined') {
            step.soakMinutes = 0;
        }
        if (
            typeof step.soakMinutes !== 'number' ||
            step.soakMinutes < 0
        ) {
            throw new Error('Step soak time must be a non-negative number');
        }

        step.rampMinutes = Math.round(step.rampMinutes);
        step.soakMinutes = Math.round(step.soakMinutes);

        if (step.rampMinutes === 0 && step.soakMinutes === 0) {
            throw new Error('Step ramp and soak times cannot both be zero');
        }
    });

    return schedule;
};

module.exports = Scheduler;
