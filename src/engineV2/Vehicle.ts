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

/* Key on: starter cranks on compression only, then the engine catches and flares */
const CRANK_MS = 750;
const CRANK_RPM = 230;
const FLARE_MS = 400;

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
    private speed = 0;

    wheel_radius = 0.335;

    state: EngineState = 'off';
    private stateSince = 0;
    private flareUntil = 0;

    async init(configuration: EngineConfiguration) {
        this.audio.dispose();
        this.drivetrain.dispose();

        this.engine.init(configuration.engine);
        this.drivetrain.init(configuration.drivetrain);
        this.wheel_radius = configuration.wheelRadius;
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
            this.driving = true;
            this.slowSince = 0;
            this.drivetrain.dispose();
            this.drivetrain.init();
            this.drivetrain.gear = this.pickGear(speed);
        }

        if (this.driving)
            this.drive(time, dt, speed, accel);
        else
            this.rev(time, dt);
    }

    start(time = performance.now()) {
        if (this.state !== 'off' && this.state !== 'stopping') return;
        this.state = 'starting';
        this.stateSince = time;
    }

    stop(time = performance.now()) {
        if (this.state !== 'running' && this.state !== 'starting') return;
        this.state = 'stopping';
        this.stateSince = time;
        this.driving = false;
        this.slowSince = 0;
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
            /* The starter spins the crank up; each compression slows it a bit */
            const spinUp = clamp(t / 150, 0, 1);
            engine.rpm = CRANK_RPM * spinUp * (1 + 0.08 * Math.sin(t * 0.06));

            if (t >= CRANK_MS) {
                this.state = 'running';
                this.flareUntil = time + FLARE_MS;
                /* Hand the crank to the physics model, the idle governor pulls it up */
                engine.omega = (engine.rpm * 2 * Math.PI) / 60;
                engine.theta = 0;
                engine.prevTheta = 0;
                starter = false;
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

        engine.omega = (engine.rpm * 2 * Math.PI) / 60;
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
        const loadTarget = accel < -0.35 ? 0 : clamp(cruise + accel / 3.2, 0, 1);
        const k = 1 - Math.exp(-dt / (loadTarget > this.load ? 0.12 : 0.25));
        this.load += (loadTarget - this.load) * k;

        const shifting = time < this.shiftUntil;
        if (this.autoShiftEnabled && !shifting)
            this.tickAutoShift(time, speed);

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
        const light = limiter * mode.upshift * 0.55;
        return light + (limiter * 0.94 - light) * Math.pow(this.load, 2);
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

    /* Manual shift while driving; a downshift that would over-rev is refused */
    nextGear(time = performance.now()) {
        if (!this.driving) return;
        this.shiftTo(this.drivetrain.gear + 1, time);
    }

    prevGear(time = performance.now()) {
        if (!this.driving) return;
        const gear = this.drivetrain.gear - 1;
        if (gear < 1 || this.rpmAt(gear, this.speed) > this.engine.limiter) return;
        this.shiftTo(gear, time);
    }
}
