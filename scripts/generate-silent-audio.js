#!/usr/bin/env node

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Generate a simple silent WAV file
function generateSilentWAV(durationSeconds = 1, sampleRate = 44100) {
  const numSamples = durationSeconds * sampleRate;
  const numChannels = 1; // Mono
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = numSamples * numChannels * bitsPerSample / 8;
  const fileSize = 36 + dataSize;

  const buffer = Buffer.alloc(44 + dataSize);
  let offset = 0;

  // RIFF header
  buffer.write('RIFF', offset); offset += 4;
  buffer.writeUInt32LE(fileSize, offset); offset += 4;
  buffer.write('WAVE', offset); offset += 4;

  // fmt chunk
  buffer.write('fmt ', offset); offset += 4;
  buffer.writeUInt32LE(16, offset); offset += 4; // chunk size
  buffer.writeUInt16LE(1, offset); offset += 2; // audio format (PCM)
  buffer.writeUInt16LE(numChannels, offset); offset += 2;
  buffer.writeUInt32LE(sampleRate, offset); offset += 4;
  buffer.writeUInt32LE(byteRate, offset); offset += 4;
  buffer.writeUInt16LE(blockAlign, offset); offset += 2;
  buffer.writeUInt16LE(bitsPerSample, offset); offset += 2;

  // data chunk
  buffer.write('data', offset); offset += 4;
  buffer.writeUInt32LE(dataSize, offset); offset += 4;

  // Silent audio data (all zeros)
  buffer.fill(0, offset);

  return buffer;
}

// Generate files
const audioFiles = [
  // BAC Mono
  'public/audio/BAC_Mono_onhigh.wav',
  'public/audio/BAC_Mono_onlow.wav',
  'public/audio/BAC_Mono_offveryhigh.wav',
  'public/audio/BAC_Mono_offlow.wav',
  
  // Common
  'public/audio/limiter.wav',
  'public/audio/trany_power_high.wav',
  'public/audio/tw_offlow_4 {0da7d8b9-9064-4108-998b-801699d71790}.wav',
  
  // Ferrari 458
  'public/audio/458/power_2 {1d0b3340-525d-418d-b809-a61f94a1d76a}.wav',
  'public/audio/458/mid_res_2 {a777a51b-a829-4637-ac37-ccdaca0a3e9b}.wav',
  'public/audio/458/off_higher {b1e2e686-3bd7-43df-9cf9-3b8c1afcffc1}.wav',
  'public/audio/458/off_midhigh {94a99615-de6b-4b18-a977-a3b5e9b10641}.wav',
  'public/audio/458/limiter.wav',
  
  // Procar
  'public/audio/procar/on_midhigh {eed64b99-c102-43cf-834e-4e4cafa68fdc}.wav',
  'public/audio/procar/on_low {0477930f-2954-45ee-8ac4-db4867fe1749}.wav',
  'public/audio/procar/off_midhigh {092a60f7-c729-4d2c-979e-2e766ba42c6c}.wav',
  'public/audio/procar/off_lower {05f28dcf-8251-4e6a-bc40-8099139ef81e}.wav'
];

console.log('Generating silent WAV files...');

const silentWAV = generateSilentWAV(2); // 2 seconds of silence

audioFiles.forEach(file => {
  try {
    writeFileSync(file, silentWAV);
    console.log(`✓ Generated ${file}`);
  } catch (error) {
    console.error(`✗ Failed to generate ${file}:`, error.message);
  }
});

console.log('Done!'); 
