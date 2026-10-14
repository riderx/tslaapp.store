import { AudioManager } from "./AudioManager";
import { Engine } from "./Engine";
import { Drivetrain } from "./Drivetrain";
import { EngineConfiguration } from "./configurations";
import { SHIFT_MODES, type ShiftMode } from "./shiftModes";
import { clamp } from "./util/clamp";

/* Below this road speed the car is considered stopped and the engine revs freely */
const PARK_BELOW = 1.0;   // m/s
const DRIVE_ABOVE = 1.6;  // m/s
const PARK_AFTER_MS = 1200;
/* GPS jitter can spike over DRIVE_ABOVE for one fix: the speed has to hold */
const DRIVE_AFTER_MS = 400;

/* Key on: starter cranks on compression only, then the engine catches and flares */
const CRANK_MS = 750;
const CRANK_RPM = 230;
const FLARE_MS = 400;
/* Synthetic voices (EV / jet) power up instead of cranking */
const POWER_UP_MS = 250;
/* Still spinning this fast after key off: the engine catches again without the starter */
const RECATCH_RPM = 300;

export type EngineState = 'off' | 'starting' | 'running' | 'stopping';

export class Vehicle {

    audio = new AudioManager();

    engine = new Engine();
    drivetrain = new Drivetrain();

    mass = 500;

    autoShiftEnabled = false;
    shiftMode: ShiftMode = 'average';
    private lastShiftAt = 0;

    /* Driving: engine follows the road through the gearbox */
    driving = false;
    load = 0;
    private shiftUntil = 0;
    private upshifting = false;
    private slowSince = 0;
    private fastSince = 0;
    private speed = 0;

    wheel_radius = 0.335;

    state: EngineState = 'off';
    private stateSince = 0;
    private flareUntil = 0;
    /* EV / jet voice: no starter, no crank */
    private synthetic = false;

    async init(configuration: EngineConfiguration) {
        this.audio.dispose();
        this.drivetrain.dispose();

        this.engine.init(configuration.engine);
        this.drivetrain.init(configuration.drivetrain);
        this.wheel_radius = configuration.wheelRadius;
        this.synthetic = !!configuration.synth.voice;
        this.driving = false;
        this.load = 0;
        this.state = 'off';
        this.engine.rpm = 0;
        this.engine.omega = 0;

        this.audio = new AudioManager();
        await this.audio.init({
            spec: configuration.synth,
            idle: this.engine.idle,
            limiter: this.engine.limiter,
        });
    }

    dispose() {
        this.autoShiftEnabled = false;
        this.drivetrain.dispose();
        this.audio.dispose();
    }

    /**
     * One frame. `speed` is the road speed in m/s, `accel` the longitudinal
     * acceleration in m/s². Moving, RPM comes from the wheels through the
     * gear ratios and load from acceleration. Stopped, the physics model
     * revs the engine in neutral from `engine.throttle` (blips).
     */
    update(time: number, dt: number, speed: number, accel: number) {
        this.speed = speed;
        if (this.state !== 'running') {
            this.ignitionFrame(time, dt);
            return;
        }
        if (this.driving) {
            if (speed < PARK_BELOW) {
                if (!this.slowSince) this.slowSince = time;
                if (time - this.slowSince > PARK_AFTER_MS) this.park();
            } else {
                this.slowSince = 0;
            }
        } else if (speed > DRIVE_ABOVE) {
            if (!this.fastSince) this.fastSince = time;
            if (time - this.fastSince > DRIVE_AFTER_MS) {
                this.driving = true;
                this.slowSince = 0;
                this.fastSince = 0;
                this.drivetrain.dispose();
                this.drivetrain.init();
                this.drivetrain.gear = this.pickGear(speed);
            }
        } else {
            this.fastSince = 0;
        }

        if (this.driving)
            this.drive(time, dt, speed, accel);
        else
            this.rev(time, dt);
    }

    /* `running`: skip the starter (switching sound with the engine already on) */
    start(time = performance.now(), running = false) {
        if (this.state !== 'off' && this.state !== 'stopping') return;
        if (running || (this.state === 'stopping' && this.engine.rpm > RECATCH_RPM)) {
            this.catch(time, running ? this.engine.idle : this.engine.rpm, false);
            return;
        }
        this.state = 'starting';
        this.stateSince = time;
    }

    /* The engine fires: hand the crank to the physics model, the idle governor pulls it up */
    private catch(time: number, rpm: number, flare: boolean) {
        const engine = this.engine;
        this.state = 'running';
        this.flareUntil = flare && !this.synthetic ? time + FLARE_MS : 0;
        engine.rpm = rpm;
        engine.omega = (rpm * 2 * Math.PI) / 60;
        engine.theta = 0;
        engine.prevTheta = 0;
    }

    stop(time = performance.now()) {
        if (this.state !== 'running' && this.state !== 'starting') return;
        this.state = 'stopping';
        this.stateSince = time;
        this.driving = false;
        this.slowSince = 0;
        this.fastSince = 0;
        this.drivetrain.gear = 0;
        this.engine.throttle = 0;
        this.load = 0;
    }

    /* Cranking, spinning down after key off, or off */
    private ignitionFrame(time: number, dt: number) {
        const engine = this.engine;
        let starter = false;

        if (this.state === 'starting') {
            const t = time - this.stateSince;
            starter = true;
            if (this.synthetic) {
                /* Power-up swell up to idle, no crank wobble */
                engine.rpm = engine.idle * clamp(t / POWER_UP_MS, 0, 1);
                if (t >= POWER_UP_MS) {
                    this.catch(time, engine.idle, false);
                    starter = false;
                }
            } else {
                /* The starter spins the crank up; each compression slows it a bit */
                const spinUp = clamp(t / 150, 0, 1);
                engine.rpm = CRANK_RPM * spinUp * (1 + 0.08 * Math.sin(t * 0.06));
                if (t >= CRANK_MS) {
                    this.catch(time, engine.rpm, true);
                    starter = false;
                }
            }
        } else if (this.state === 'stopping') {
            engine.rpm += (0 - engine.rpm) * (1 - Math.exp(-dt / 0.3));
            if (engine.rpm < 40) {
                engine.rpm = 0;
                this.state = 'off';
            }
        } else {
            engine.rpm = 0;
        }

        if (this.state !== 'running') engine.omega = (engine.rpm * 2 * Math.PI) / 60;
        engine.throttle = 0;
        this.load = 0;

        this.audio.update({
            rpm: engine.rpm,
            load: 0,
            cut: false,
            gearRatio: 0,
            ignition: this.state === 'running',
            starter,
        });
    }

    /* Stopped: free revving in neutral */
    private rev(time: number, dt: number) {
        /* Catching after the starter: a short flare above idle */
        if (time < this.flareUntil)
            this.engine.throttle = Math.max(this.engine.throttle, 0.55);

        const subSteps = 20;
        const h = dt / subSteps;

        for (let i = 0; i < subSteps; i++) {
            this.engine.integrate(0, time + dt * i, h);
            this.drivetrain.integrate(h);
            this.engine.update(h);
            this.drivetrain.update(h);
        }

        this.load = this.engine.throttle;
        this.audio.update({
            rpm: this.engine.rpm,
            load: this.engine.throttle,
            cut: this.engine.rpm >= this.engine.soft_limiter,
            gearRatio: 0,
            ignition: true,
            starter: false,
        });
    }

    private park() {
        this.driving = false;
        this.slowSince = 0;
        this.drivetrain.gear = 0;
        this.engine.throttle = 0;
        /* Hand the current revs to the physics model so they settle to idle */
        this.engine.omega = (this.engine.rpm * 2 * Math.PI) / 60;
        this.engine.theta = 0;
        this.engine.prevTheta = 0;
    }

    private drive(time: number, dt: number, speed: number, accel: number) {
        const engine = this.engine;

        /* Load: rolling resistance at cruise, plus whatever accelerates the car */
        const cruise = 0.1 + 0.25 * clamp(speed / 40, 0, 1);
        /* Lifting off in a Tesla means regen, well past -0.8 m/s²; milder is GPS noise or a slope */
        const loadTarget = accel < -0.8 ? 0 : clamp(cruise + accel / 3.2, 0, 1);
        const k = 1 - Math.exp(-dt / (loadTarget > this.load ? 0.12 : 0.25));
        this.load += (loadTarget - this.load) * k;

        const shifting = time < this.shiftUntil;
        if (this.autoShiftEnabled && !shifting)
            this.tickAutoShift(time, speed);

        /* Back from a GPS gap far too fast for this gear: jump straight to the right one */
        if (this.rpmAt(this.drivetrain.gear, speed) > engine.limiter * 1.05)
            this.drivetrain.gear = this.pickGear(speed);

        const gear = this.drivetrain.gear;
        let rpm = this.rpmAt(gear, speed);

        /* Clutch slip pulling away in first */
        if (gear === 1) {
            const slip = engine.idle + this.load * (engine.limiter - engine.idle) * 0.3;
            rpm = Math.max(rpm, slip * (1 - clamp(speed / 6, 0, 1)) + rpm * clamp(speed / 6, 0, 1));
        }
        rpm = clamp(rpm, engine.idle, engine.limiter);

        /* The flywheel spins down / is blipped up to the new gear over the shift */
        const tau = shifting ? Math.max(this.drivetrain.shiftTime, 60) / 1000 : 0.05;
        engine.rpm += (rpm - engine.rpm) * (1 - Math.exp(-dt / tau));
        engine.omega = (engine.rpm * 2 * Math.PI) / 60;

        const downshiftBlip = shifting && !this.upshifting;
        engine.throttle = downshiftBlip ? Math.max(this.load, 0.6) : this.load;

        this.audio.update({
            rpm: engine.rpm,
            load: engine.throttle,
            cut: engine.rpm >= engine.soft_limiter || (shifting && this.upshifting),
            gearRatio: this.drivetrain.getGearRatio(),
            ignition: true,
            starter: false,
        });
    }

    rpmAt(gear: number, speed: number) {
        if (gear <= 0) return this.engine.idle;
        const wheelRpm = (speed / (2 * Math.PI * this.wheel_radius)) * 60;
        return wheelRpm * this.drivetrain.getGearRatio(gear) * this.drivetrain.getFinalDriveRatio();
    }

    /* Highest gear that keeps the engine above its comfortable minimum */
    private pickGear(speed: number) {
        const gears = this.drivetrain.gears.length;
        const floor = this.downshiftRpm();
        for (let g = gears; g > 1; g--) {
            if (this.rpmAt(g, speed) >= floor * 1.3) return g;
        }
        return 1;
    }

    private upshiftRpm() {
        const mode = SHIFT_MODES[this.shiftMode];
        const limiter = this.engine.limiter;
        const light = limiter * (0.25 + 0.3 * mode.upshift);
        return light + (limiter * 0.94 - light) * Math.pow(this.load, 1.5);
    }

    private downshiftRpm() {
        const mode = SHIFT_MODES[this.shiftMode];
        return Math.max(this.engine.idle * 1.15, this.engine.limiter * mode.downshift * 0.8);
    }

    private tickAutoShift(time: number, speed: number) {
        const mode = SHIFT_MODES[this.shiftMode];
        if (time - this.lastShiftAt < mode.intervalMs)
            return;

        const gear = this.drivetrain.gear;
        const rpm = this.rpmAt(gear, speed);
        const up = this.upshiftRpm();

        if (gear < this.drivetrain.gears.length && rpm >= up && this.rpmAt(gear + 1, speed) > this.downshiftRpm()) {
            this.shiftTo(gear + 1, time);
            return;
        }

        if (gear > 1) {
            const lower = this.rpmAt(gear - 1, speed);
            /* Kickdown when asked for power, or the engine is lugging */
            const kickdown = this.load > 0.6 && lower < up * 0.85;
            if ((kickdown || rpm < this.downshiftRpm()) && lower < up * 0.9)
                this.shiftTo(gear - 1, time);
        }
    }

    private shiftTo(gear: number, time: number) {
        gear = clamp(gear, 1, this.drivetrain.gears.length);
        if (gear === this.drivetrain.gear) return;
        this.upshifting = gear > this.drivetrain.gear;
        this.drivetrain.gear = gear;
        this.lastShiftAt = time;
        this.shiftUntil = time + Math.max(this.drivetrain.shiftTime, 60) * 2;
    }

    setShiftMode(mode: ShiftMode) {
        this.shiftMode = mode;
    }

    /*
     * Manual shift while driving, one gear per shift: a scroll-wheel flick sends a
     * burst of events. Returns false when refused (mid-shift, no gear, would over-rev).
     */
    nextGear(time = performance.now()) {
        if (!this.driving || time < this.shiftUntil) return false;
        const gear = this.drivetrain.gear + 1;
        if (gear > this.drivetrain.gears.length) return false;
        this.shiftTo(gear, time);
        return true;
    }

    prevGear(time = performance.now()) {
        if (!this.driving || time < this.shiftUntil) return false;
        const gear = this.drivetrain.gear - 1;
        if (gear < 1 || this.rpmAt(gear, this.speed) > this.engine.limiter) return false;
        this.shiftTo(gear, time);
        return true;
    }
}
