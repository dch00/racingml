// ============================================================
// AGENT.JS -- Neural network and genetic algorithm
// READ ONLY -- do not modify this file.
// Your work goes in fitness.js.
// ============================================================


// ============================================================
// NEURAL NETWORK
// Feedforward network with tanh activation.
//
// Architecture:
//   Input  layer: 6 nodes  (5 sensor distances + speed)
//   Hidden layer: 8 nodes
//   Output layer: 4 nodes  (accelerate, brake, left, right)
//
// Outputs > 0 activate that control.
// ============================================================

const NN_LAYER_SIZES = [6, 8, 4];

class NeuralNetwork {
  constructor(sizes = NN_LAYER_SIZES) {
    this.sizes   = sizes;
    this.weights = [];   // weights[layer][output node][input node]
    this.biases  = [];   // biases[layer][output node]

    for (let i = 1; i < sizes.length; i++) {
      const layerW = [];
      const layerB = [];
      for (let j = 0; j < sizes[i]; j++) {
        layerW.push(
          Array.from({ length: sizes[i - 1] }, () => (Math.random() * 2 - 1) * 0.6)
        );
        layerB.push((Math.random() * 2 - 1) * 0.1);
      }
      this.weights.push(layerW);
      this.biases.push(layerB);
    }
  }

  // Run inputs through the network and return outputs
  forward(inputs) {
    let current = [...inputs];
    for (let l = 0; l < this.weights.length; l++) {
      const next = [];
      for (let j = 0; j < this.weights[l].length; j++) {
        let sum = this.biases[l][j];
        for (let k = 0; k < current.length; k++) {
          sum += current[k] * this.weights[l][j][k];
        }
        next.push(Math.tanh(sum));
      }
      current = next;
    }
    return current;
  }

  // Return a deep copy of this network
  clone() {
    const nn   = new NeuralNetwork(this.sizes);
    nn.weights = this.weights.map(layer => layer.map(row => [...row]));
    nn.biases  = this.biases.map(layer => [...layer]);
    return nn;
  }

  // Randomly adjust some weights and biases
  mutate(rate = 0.12, strength = 0.35) {
    this.weights = this.weights.map(layer =>
      layer.map(row =>
        row.map(w => Math.random() < rate ? w + (Math.random() * 2 - 1) * strength : w)
      )
    );
    this.biases = this.biases.map(layer =>
      layer.map(b => Math.random() < rate ? b + (Math.random() * 2 - 1) * strength : b)
    );
    return this;
  }

  // Combine this network with another (each weight randomly from one parent)
  crossover(other) {
    const child = this.clone();
    child.weights = child.weights.map((layer, i) =>
      layer.map((row, j) =>
        row.map((w, k) => Math.random() < 0.5 ? w : other.weights[i][j][k])
      )
    );
    child.biases = child.biases.map((layer, i) =>
      layer.map((b, j) => Math.random() < 0.5 ? b : other.biases[i][j])
    );
    return child;
  }
}


// ============================================================
// GENETIC TRAINER
//
// Runs a population of cars each generation.
// After each generation, the best-performing cars
// (by fitness score) produce offspring for the next generation.
//
// The fitness score comes from fitness.js -- that is the
// only part students need to change.
// ============================================================

const POPULATION_SIZE   = 20;
const ELITE_COUNT       = 4;      // top N brains kept unchanged
const MUTATION_RATE     = 0.12;
const MUTATION_STRENGTH = 0.35;
const MAX_GEN_FRAMES    = 18 * 60; // 18 seconds at 60fps

class GeneticTrainer {
  constructor() {
    this.generation  = 0;
    this.frameCount  = 0;
    this.cars        = [];
    this.allTimeBest = 0;
    this.bestBrain   = null;
    this.history     = [];       // best fitness score per generation
    this._watchCar   = null;

    this._startGeneration();
  }

  // ---- Current generation ------------------------------------

  update() {
    this.frameCount++;

    this.cars.forEach(car => {
      if (!car.alive) return;
      const controls = car.think();
      car.update(controls);
      car.fitness = computeFitness(car);
    });

    const allDead = this.cars.every(c => !c.alive);
    if (allDead || this.frameCount >= MAX_GEN_FRAMES) {
      this._evolve();
    }

    // Keep watch car in sync
    if (this._watchCar) {
      const controls = this._watchCar.think();
      this._watchCar.update(controls);
      if (!this._watchCar.alive) {
        this._watchCar = this._freshWatchCar();
      }
    }
  }

  // The car with the highest current fitness in this generation
  get bestCar() {
    return this.cars.reduce(
      (best, car) => car.fitness > best.fitness ? car : best,
      this.cars[0]
    );
  }

  // A car running the best-ever brain (for Watch mode)
  get watchCar() {
    if (!this._watchCar && this.bestBrain) {
      this._watchCar = this._freshWatchCar();
    }
    return this._watchCar;
  }

  _freshWatchCar() {
    return this.bestBrain ? new Car(this.bestBrain.clone()) : null;
  }

  // ---- Evolution ---------------------------------------------

  _evolve() {
    // Final fitness score for everyone
    this.cars.forEach(car => { car.fitness = computeFitness(car); });

    // Sort best to worst
    this.cars.sort((a, b) => b.fitness - a.fitness);

    const topFitness = this.cars[0].fitness;
    this.history.push(topFitness);

    if (topFitness > this.allTimeBest) {
      this.allTimeBest = topFitness;
      this.bestBrain   = this.cars[0].brain.clone();
      // Reset watch car to use new best brain
      this._watchCar   = this._freshWatchCar();
    }

    // Build new generation
    const newBrains = [];

    // Keep top performers unchanged (elitism)
    for (let i = 0; i < ELITE_COUNT && i < this.cars.length; i++) {
      newBrains.push(this.cars[i].brain.clone());
    }

    // Fill the rest with offspring from the elite
    while (newBrains.length < POPULATION_SIZE) {
      const ia    = Math.floor(Math.random() * ELITE_COUNT);
      const ib    = Math.floor(Math.random() * ELITE_COUNT);
      const child = this.cars[ia].brain
        .crossover(this.cars[ib].brain)
        .mutate(MUTATION_RATE, MUTATION_STRENGTH);
      newBrains.push(child);
    }

    this._startGeneration(newBrains);
  }

  _startGeneration(brains = null) {
    this.generation++;
    this.frameCount = 0;
    this.cars = Array.from({ length: POPULATION_SIZE }, (_, i) => {
      let brain;
      if (brains) {
        brain = brains[i];
      } else if (this.bestBrain && i > 0) {
        brain = this.bestBrain.clone().mutate(MUTATION_RATE, MUTATION_STRENGTH);
      } else if (this.bestBrain) {
        brain = this.bestBrain.clone();
      } else {
        brain = new NeuralNetwork();
      }
      return new Car(brain);
    });
  }
}