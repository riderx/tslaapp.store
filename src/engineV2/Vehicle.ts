import { AudioManager } from "./AudioManager";
import { Engine } from "./Engine";
import { Drivetrain } from "./Drivetrain";
import { EngineConfiguration } from "./configurations";
import { SHIFT_MODES, type ShiftMode } from "./shiftModes";

export class Vehicle {

    audio = new AudioManager();

    engine = new Engine();
    drivetrain = new Drivetrain();
    
    mass = 500;

    autoShiftEnabled = false;
    shiftMode: ShiftMode = 'average';
    private lastAutoShiftAt = 0;
    private gearHoldStartedAt = 0;

    velocity = 0;
    wheel_rpm = 0;
    wheel_omega = 0;
    wheel_radius = 0.250;

    async init(configuration: EngineConfiguration) {
        this.audio.dispose();
        this.drivetrain.dispose();

        this.engine.init(configuration.engine);
        this.drivetrain.init(configuration.drivetrain);

        this.audio = new AudioManager();
        await this.audio.init(configuration.sounds);
    }

    dispose() {
        this.autoShiftEnabled = false;
        this.drivetrain.dispose();
        this.audio.dispose();
    }

    // https://github.com/markeasting/THREE-XPBD
    // http://www.thecartech.com/subjects/auto_eng/car_performance_formulas.htm
    // https://pressbooks-dev.oer.hawaii.edu/collegephysics/chapter/10-3-dynamics-of-rotational-motion-rotational-inertia/
    update(time: number, dt: number) {

        /* Simulation loop */
        const subSteps = 20;
        const h = dt / subSteps;

        /* Light virtual load for parked sound-sim */
        const I = this.getLoadInertia() * 0.02;

        for (let i = 0; i < subSteps; i++) {
            
            this.engine.integrate(I, time + dt * i, h);
            this.drivetrain.integrate(h);

            this.engine.solvePos(this.drivetrain, h);
            this.drivetrain.solvePos(this.engine, h);
            
            this.engine.update(h);
            this.drivetrain.update(h);

            this.engine.solveVel(this.drivetrain, h);
            this.drivetrain.solveVel(this.engine, h);
            
        }

        // if (this.drivetrain.gear > 0) {
        //     this.velocity += (this.drivetrain.omega / this.drivetrain.getTotalGearRatio()) * this.wheel_radius * dt;
        //     console.log(this.velocity);
        // }

        this.tickAutoShift(time);

        if (this.audio.ctx)
            this.engine.applySounds(this.audio.samples, this.drivetrain.getGearRatio());
    }

    getLoadInertia() {
        if (this.drivetrain.gear == 0)
            return 0;

        const gearRatio = this.drivetrain.getGearRatio();
        const totalGearRatio = this.drivetrain.getTotalGearRatio();

        const I_veh = this.mass * Math.pow(this.wheel_radius, 2);
        const I_wheels = 4 * 12.0 * Math.pow(this.wheel_radius, 2);

        const I1 = I_veh / Math.pow(totalGearRatio, 2);
        const I2 = I_wheels / Math.pow(totalGearRatio, 2);
        const I3 = this.drivetrain.inertia / Math.pow(gearRatio, 2);

        return I1 + I2 + I3;
    }

    setShiftMode(mode: ShiftMode) {
        this.shiftMode = mode;
    }

    private tickAutoShift(time: number) {
        if (!this.autoShiftEnabled || this.drivetrain.isShifting)
            return;

        const mode = SHIFT_MODES[this.shiftMode];
        if (time - this.lastAutoShiftAt < mode.intervalMs)
            return;

        const limiter = Math.max(this.engine.limiter, 1);
        const upRpm = limiter * mode.upshift;
        const downRpm = limiter * mode.downshift;
        const rpm = this.engine.rpm;
        const throttle = this.engine.throttle;
        const gear = this.drivetrain.gear;
        const maxGear = this.drivetrain.gears.length;

        /* Pull away from neutral when throttle applied */
        if (gear === 0 && throttle > 0.12) {
            this.nextGear();
            this.lastAutoShiftAt = time;
            this.gearHoldStartedAt = time;
            return;
        }

        if (gear <= 0) {
            this.gearHoldStartedAt = time;
            return;
        }

        if (this.gearHoldStartedAt <= 0)
            this.gearHoldStartedAt = time;

        const held = time - this.gearHoldStartedAt;
        const shouldUpshift =
            gear < maxGear &&
            throttle > 0.18 &&
            (rpm >= upRpm || (throttle > 0.55 && held >= mode.maxHoldMs));

        if (shouldUpshift) {
            this.nextGear();
            this.lastAutoShiftAt = time;
            this.gearHoldStartedAt = time;
            return;
        }

        if (gear > 1 && throttle < 0.4 && rpm <= downRpm) {
            this.prevGear();
            this.lastAutoShiftAt = time;
            this.gearHoldStartedAt = time;
        }
    }


    nextGear() {
        this.drivetrain.nextGear(this.engine);
    }

    prevGear() {
        this.drivetrain.prevGear(this.engine);
    }

    changeGear(gear: number) {
        this.drivetrain.changeGear(gear, this.engine);
    }

}
