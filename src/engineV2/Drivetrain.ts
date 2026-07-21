import { Engine } from "./Engine";
import { clamp } from "./util/clamp";

export class Drivetrain {

    gear = 0;
    clutch = 1.0;
    downShift = false;

    // gears = [3.17, 2.36, 1.80, 1.47, 1.24, 1.11];
    gears = [3.4, 2.36, 1.85, 1.47, 1.24, 1.07];
    final_drive = 3.44;

    theta: number = 0;
    omega: number = 0;
    prevTheta: number = 0;
    prevOmega: number = 0;

    theta_wheel: number = 0;
    omega_wheel: number = 0;
    
    /* Inertia of geartrain + drive shaft [kg m2] */
    inertia = 0.1 + 0.05; /* 0.5 * MR^2 */
    damping = 12;
    compliance = 0.01;

    shiftTime = 50;

    private shiftTimer: ReturnType<typeof setTimeout> | null = null;

    get isShifting() {
        return this.shiftTimer !== null;
    }

    private disposed = false;

    dispose() {
        this.disposed = true;
        if (this.shiftTimer) {
            clearTimeout(this.shiftTimer);
            this.shiftTimer = null;
        }
    }

    constructor() {
        this.init();
    }

    init(config?: Partial<Drivetrain>) {
        this.disposed = false;
        if (config) Object.assign(this, config);

        if (this.shiftTimer) {
            clearTimeout(this.shiftTimer);
            this.shiftTimer = null;
        }

        this.theta = 0;
        this.omega = 0;
        this.prevTheta = 0;
        this.prevOmega = 0;
        this.theta_wheel = 0;
        this.omega_wheel = 0;

        this.gear = 0;
        this.downShift = false;
    }

    /** Lock drivetrain shaft state to the engine before engaging a gear. */
    syncToEngine(engine: Engine) {
        this.theta = engine.theta;
        this.prevTheta = engine.theta;
        this.omega = engine.omega;
        this.prevOmega = engine.omega;
    }

    integrate(dt: number) {

        this.clutch = clamp(this.clutch, 0, 1);

        this.prevTheta = this.theta;
        this.theta += this.omega * dt;
    }

    update(h: number) {
        this.prevOmega = this.omega;

        const dTheta = (this.theta - this.prevTheta) / h;

        this.omega = dTheta;
    }

    solvePos(engine: Engine, h: number) {
        if (this.gear === 0)
            return;

        const c = engine.theta - this.theta;
        const corr1 = this.getCorrection(c, h, this.compliance);
        this.theta += corr1 * Math.sign(c);
    }

    solveVel(engine: Engine, h: number) {
        if (this.gear === 0)
            return;

        let damping = Math.min(this.damping, 5);

        if (this.gear > 3)
            damping *= 0.75;

        this.omega += (engine.omega - this.omega) * damping * h;
        if (this.omega < 0) this.omega = 0;
    }

    getCorrection(corr: number, h: number, compliance = 0) {

        const w = corr * corr * 1/this.inertia; // idk?

        const dlambda = -corr / (w + compliance / h / h);
        
        return corr * -dlambda;
    }

    getFinalDriveRatio() {
        return this.final_drive;
    }

    getGearRatio(gear?: number) {
        gear = gear ?? this.gear;

        gear = clamp(gear, 0, this.gears.length);

        const ratio = gear > 0 
            ? this.gears[gear - 1] 
            : 0;

        return ratio;
    }

    getTotalGearRatio() {
        return this.getGearRatio() * this.getFinalDriveRatio();
    }

    changeGear(gear: number, engine?: Engine) {
        gear = clamp(gear, 0, this.gears.length);
        if (gear === this.gear)
            return;

        const prevGear = this.gear;
        const prevRatio = this.getGearRatio(prevGear);
        const nextRatio = this.getGearRatio(gear);

        /* Neutral while shifting */
        this.gear = 0;
        this.downShift = prevGear > 0 && gear > 0 && nextRatio > prevRatio;

        if (this.shiftTimer) {
            clearTimeout(this.shiftTimer);
            this.shiftTimer = null;
        }

        const engage = () => {
            this.shiftTimer = null;
            if (this.disposed)
                return;

            if (gear === 0) {
                this.gear = 0;
                this.downShift = false;
                return;
            }

            if (engine) {
                /* Always match shaft to engine on engage — avoids theta/omega explosion after free-rev in N */
                this.syncToEngine(engine);
            } else if (prevRatio > 0 && nextRatio > 0) {
                this.omega = this.omega * (nextRatio / prevRatio);
            }

            this.gear = gear;
            this.downShift = false;
        };

        if (this.shiftTime <= 0) {
            engage();
        } else {
            this.shiftTimer = setTimeout(engage, this.shiftTime);
        }
    }

    nextGear(engine?: Engine) {
        this.changeGear(this.gear + 1, engine);
    }

    prevGear(engine?: Engine) {
        this.changeGear(this.gear - 1, engine);
    }
}
