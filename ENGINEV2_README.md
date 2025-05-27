# Engine V2 System

The new engineV2 system replaces the old WASM-based engine sound generator with a more flexible and maintainable TypeScript-based solution.

## Features

- **Real-time engine simulation** with physics-based RPM calculation
- **Multiple engine configurations** (BAC Mono, Ferrari 458, Procar)
- **Gear shifting system** with automatic and manual controls
- **Audio crossfading** between different engine states
- **Sensor integration** for GPS speed and accelerometer data
- **Test acceleration** mode for development and demonstration

## Architecture

### Core Components

- **`Vehicle.ts`** - Main vehicle class that orchestrates engine, drivetrain, and audio
- **`Engine.ts`** - Engine simulation with torque curves, RPM limiting, and physics
- **`Drivetrain.ts`** - Gear system with realistic gear ratios and shifting
- **`AudioManager.ts`** - Audio system for loading and playing engine sounds
- **`configurations.ts`** - Pre-defined engine configurations

### Audio System

The audio system uses multiple audio samples that are crossfaded based on:
- **RPM range** (low/high frequency bands)
- **Throttle state** (on/off throttle)
- **Engine state** (normal/limiter)
- **Transmission** (gear whine effects)

## Usage

### Basic Setup

```typescript
import { Vehicle } from './engineV2/Vehicle'
import { bac_mono } from './engineV2/configurations'

const vehicle = new Vehicle()
await vehicle.init(bac_mono)

// Update loop
function update(time: number, dt: number) {
  vehicle.engine.throttle = 0.5 // Set throttle (0-1)
  vehicle.update(time, dt)
  
  // Access engine data
  console.log('RPM:', vehicle.engine.rpm)
  console.log('Gear:', vehicle.drivetrain.gear)
}
```

### CarSoundV2 Component

The updated Vue component provides:
- **Real-time dashboard** showing RPM, speed, throttle, and gear
- **Engine configuration selection** 
- **Manual gear shifting** controls
- **Sensor integration** for mobile devices
- **Test acceleration** mode
- **Volume and sensitivity controls**

## Audio Files

Audio files should be placed in `public/audio/` with the following structure:

```
public/audio/
├── BAC_Mono_onhigh.wav
├── BAC_Mono_onlow.wav
├── BAC_Mono_offveryhigh.wav
├── BAC_Mono_offlow.wav
├── limiter.wav
├── 458/
│   ├── power_2 {uuid}.wav
│   ├── mid_res_2 {uuid}.wav
│   └── ...
└── procar/
    ├── on_midhigh {uuid}.wav
    └── ...
```

Use the `scripts/generate-silent-audio.js` script to create placeholder files for testing.

## Configuration

Engine configurations define:
- **Engine parameters** (RPM limits, inertia, torque)
- **Drivetrain settings** (gear ratios, shift timing)
- **Audio mappings** (file paths and RPM ranges)

Example:
```typescript
export const my_engine: EngineConfiguration = {
  engine: {
    limiter: 8000,
    soft_limiter: 7800,
    inertia: 1.0
  },
  drivetrain: {
    gears: [3.4, 2.36, 1.85, 1.47, 1.24, 1.07],
    final_drive: 3.44
  },
  sounds: {
    on_high: { source: 'audio/my_engine_high.wav', rpm: 6000 },
    // ... more sounds
  }
}
```

## Development

To test the system:
1. Run `node scripts/generate-silent-audio.js` to create placeholder audio files
2. Start the dev server: `npm run dev`
3. Navigate to `/car-sound-v2`
4. Click "Start Engine" and test the controls

## Migration from V1

The new system replaces:
- WASM-based sound generation → Sample-based audio playback
- Fixed engine parameters → Configurable engine types
- Basic RPM control → Full physics simulation
- Limited UI → Comprehensive dashboard and controls 
