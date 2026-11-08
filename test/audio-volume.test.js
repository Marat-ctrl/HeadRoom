const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const defaults = require('../src/renderer/defaults.json');

test('fresh profiles start with a quiet volume and the engine applies it', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/audio.js'), 'utf8'), context);
  const audio = new context.RiffAudioEngine();

  assert.equal(defaults.riff_volume, '0.2');
  assert.equal(audio.volume, Number(defaults.riff_volume));
  audio.setVolume(audio.volume, false);
  assert.ok(Math.abs(audio.appliedElementVolume - 0.04) < 1e-8);
  audio.setVolume(0.5, false);
  assert.equal(audio.appliedElementVolume, 0.25);
  audio.setVolume(NaN, false);
  assert.ok(Math.abs(audio.appliedElementVolume - 0.04) < 1e-8);
});

test('the normalization meter receives the dry signal with flat EQ', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/audio.js'), 'utf8'), context);
  const audio = new context.RiffAudioEngine();
  const node = () => ({connections: [], connect(target) { this.connections.push(target); }, disconnect(target) { this.connections = target ? this.connections.filter(node => node !== target) : []; }});
  for (const name of [
    'mediaSource', 'stdInput', 'hqLimiter', 'bus', 'dryGain', 'masterGain', 'levelAnalyser',
    'distortionNode', 'distortionGain', 'delayGain', 'convolverNode', 'reverbGain'
  ]) audio[name] = node();
  audio.graphInitialized = true;
  audio._applyHqParams = () => {};
  audio._updateRouting();
  assert.ok(audio.stdInput.connections.includes(audio.bus));
  assert.ok(audio.bus.connections.includes(audio.dryGain));
  assert.ok(!audio.dryGain.connections.includes(audio.levelAnalyser));
  audio.setLevelMeterEnabled(true);
  assert.ok(audio.dryGain.connections.includes(audio.levelAnalyser));
  assert.ok(audio.dryGain.connections.includes(audio.masterGain));
  audio.setLevelMeterEnabled(false);
  assert.ok(!audio.dryGain.connections.includes(audio.levelAnalyser));
  assert.ok(audio.dryGain.connections.includes(audio.masterGain));
});

test('normalization measures the source independently of listening volume', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/audio.js'), 'utf8'), context);
  const audio = new context.RiffAudioEngine();
  audio.levelBuf = new Float32Array(8);
  audio._attachedElement = {volume: 0.04};
  audio.levelAnalyser = {
    getFloatTimeDomainData(buffer) { buffer.fill(0.1 * audio._attachedElement.volume); }
  };
  assert.ok(Math.abs(audio.getLevelDb() - (-20)) < 0.01);
  audio._attachedElement.volume = 0.5;
  assert.ok(Math.abs(audio.getLevelDb() - (-20)) < 0.01);
  audio._attachedElement.volume = 0;
  assert.equal(audio.getLevelDb(), -120);
});
