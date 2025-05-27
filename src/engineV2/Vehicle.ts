import { AudioManager } from "./AudioManager";
import { Engine } from "./Engine";
import { Drivetrain } from "./Drivetrain";
import { EngineConfiguration } from "./configurations";

export class Vehicle {

    audio = new AudioManager();

    engine = new Engine();;
    drivetrain = new Drivetrain();
    
    mass = 500;

    velocity = 0;
    wheel_rpm = 0;
    wheel_omega = 0;
    wheel_radius = 0.250;

    async init(configuration: EngineConfiguration) {
        if (this.audio)
            this.audio.dispose();

        this.engine.init(configuration.engine);
        this.drivetrain.init(configuration.drivetrain);

        this.audio = new AudioManager();
        
        await this.audio.init(configuration.sounds);
    }

    // https://github.com/markeasting/THREE-XPBD
    // http://www.thecartech.com/subjects/auto_eng/car_performance_formulas.htm
    // https://pressbooks-dev.oer.hawaii.edu/collegephysics/chapter/10-3-dynamics-of-rotational-motion-rotational-inertia/
    update(time: number, dt: number) {

        /* Simulation loop */
        const subSteps = 20;
        const h = dt / subSteps;

        const I = this.getLoadInertia() * 0.00;

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

        if (this.audio.ctx)
            this.engine.applySounds(this.audio.samples, this.drivetrain.gear);
    }

    getLoadInertia() {
        if (this.drivetrain.gear == 0)
            return 0;
            
        const gearRatio = this.drivetrain.getGearRatio();
        const totalGearRatio = this.drivetrain.getTotalGearRatio();

        /* Moment of inertia - I = mr^2 */
        const I_veh = this.mass * Math.pow(this.wheel_radius, 2);
        const I_wheels = 4 * 12.0 * Math.pow(this.wheel_radius, 2);

        /* Adjust inertia for gear ratio */
        const I1 = I_veh / Math.pow(totalGearRatio, 2); 
        const I2 = I_wheels / Math.pow(totalGearRatio, 2); 
        const I3 = this.drivetrain.inertia / Math.pow(gearRatio, 2); 
        const I = I1 + I2 + I3;

        return I;
    }

}
