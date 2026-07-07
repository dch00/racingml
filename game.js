// ============================================================
// GAME.JS -- Track, car physics, neural network, genetic algorithm
// READ ONLY -- do not modify this file.
// Your work goes in fitness.js.
// ============================================================


// ============================================================
// CANVAS DIMENSIONS
// ============================================================
const CANVAS_W = 760;
const CANVAS_H = 460;


// ============================================================
// TRACK DEFINITION
//
// The track is defined as a set of control points. A Catmull-Rom
// spline runs through them to produce a smooth closed circuit.
// The car travels counterclockwise.
//
// Track features:
//   - Long straight along the top
//   - Tight hairpin on the left
//   - S-curve chicane on the bottom right
//   - Sweeping final corner back to start
// ============================================================
var CTRL_POINTS = [
  {x: 400, y: 200},   // 0: start / finish  ← middle of top straight
  {x: 145, y: 215},   // 1: hairpin approach
  {x: 82,  y: 268},   // 2: hairpin apex
  {x: 98,  y: 340},   // 3: hairpin exit
  {x: 205, y: 392},   // 4: bottom left turn
  {x: 350, y: 410},   // 5: bottom straight
  {x: 470, y: 402},   // 6: chicane entry
  {x: 562, y: 372},   // 7: chicane right
  {x: 518, y: 308},   // 8: chicane left
  {x: 608, y: 268},   // 9: final corner
  {x: 620, y: 220},   // 10: top right kink
];

var TRACK_WIDTH = 66;  // visible track width in pixels

// Generate smooth centerline via Catmull-Rom spline
function generateCenterline(ctrlPts, segmentsPerPoint) {
  segmentsPerPoint = segmentsPerPoint || 22;
  var pts    = ctrlPts;
  var n      = pts.length;
  var result = [];

  for (var i = 0; i < n; i++) {
    var p0 = pts[(i - 1 + n) % n];
    var p1 = pts[i];
    var p2 = pts[(i + 1) % n];
    var p3 = pts[(i + 2) % n];

    for (var t = 0; t < segmentsPerPoint; t++) {
      var s  = t / segmentsPerPoint;
      var s2 = s * s;
      var s3 = s2 * s;
      result.push({
        x: 0.5 * ((2*p1.x) + (-p0.x + p2.x)*s + (2*p0.x - 5*p1.x + 4*p2.x - p3.x)*s2 + (-p0.x + 3*p1.x - 3*p2.x + p3.x)*s3),
        y: 0.5 * ((2*p1.y) + (-p0.y + p2.y)*s + (2*p0.y - 5*p1.y + 4*p2.y - p3.y)*s2 + (-p0.y + 3*p1.y - 3*p2.y + p3.y)*s3)
      });
    }
  }
  return result;
}

var CENTERLINE = generateCenterline(CTRL_POINTS);

// Start position: first centerline point, facing toward the second
var START_X     = CENTERLINE[0].x;
var START_Y     = CENTERLINE[0].y;
var START_ANGLE = Math.atan2(
  CENTERLINE[1].y - CENTERLINE[0].y,
  CENTERLINE[1].x - CENTERLINE[0].x
);

// Nearest centerline point search (used for progress tracking)
function nearestCenterlineIdx(x, y) {
  var minD2 = Infinity;
  var idx   = 0;
  for (var i = 0; i < CENTERLINE.length; i++) {
    var dx = x - CENTERLINE[i].x;
    var dy = y - CENTERLINE[i].y;
    var d2 = dx*dx + dy*dy;
    if (d2 < minD2) { minD2 = d2; idx = i; }
  }
  return idx;
}


// ============================================================
// TERRAIN MAP
// Drawn once into a flat Uint8Array. 0 = track, 1 = grass.
// Fast array lookups replace per-frame canvas reads.
// ============================================================
var terrainMap = new Uint8Array(CANVAS_W * CANVAS_H);

(function buildTerrainMap() {
  var off    = document.createElement("canvas");
  off.width  = CANVAS_W;
  off.height = CANVAS_H;
  var octx   = off.getContext("2d");

  // Grass everywhere first
  octx.fillStyle = "#22aa22";
  octx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Draw track as a thick closed stroke
  octx.strokeStyle = "#888888";
  octx.lineWidth   = TRACK_WIDTH;
  octx.lineCap     = "round";
  octx.lineJoin    = "round";
  octx.beginPath();
  octx.moveTo(CENTERLINE[0].x, CENTERLINE[0].y);
  for (var i = 1; i < CENTERLINE.length; i++) {
    octx.lineTo(CENTERLINE[i].x, CENTERLINE[i].y);
  }
  octx.closePath();
  octx.stroke();

  var img = octx.getImageData(0, 0, CANVAS_W, CANVAS_H);
  for (var j = 0; j < terrainMap.length; j++) {
    terrainMap[j] = img.data[j * 4 + 1] > img.data[j * 4] ? 1 : 0;
  }
})();

function isGrassAt(x, y) {
  var px = Math.max(0, Math.min(CANVAS_W - 1, Math.round(x)));
  var py = Math.max(0, Math.min(CANVAS_H - 1, Math.round(y)));
  return terrainMap[py * CANVAS_W + px] === 1;
}


// ============================================================
// SENSORS
// 5 rays fan out: left 90, left 45, ahead, right 45, right 90
// Each returns a 0–1 value: 0 = wall right here, 1 = clear ahead
// ============================================================
var SENSOR_ANGLES = [-Math.PI / 2, -Math.PI / 4, 0, Math.PI / 4, Math.PI / 2];
var SENSOR_MAX    = 130;
var SENSOR_STEP   = 3;

function castRay(x, y, angle) {
  for (var d = SENSOR_STEP; d < SENSOR_MAX; d += SENSOR_STEP) {
    var rx = x + Math.cos(angle) * d;
    var ry = y + Math.sin(angle) * d;
    if (isGrassAt(rx, ry)) return d / SENSOR_MAX;
  }
  return 1.0;
}


// ============================================================
// TRACK DRAWING (visual canvas)
// ============================================================
function drawTrack(ctx) {
  // Background grass
  ctx.fillStyle = "#2a6b2a";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Track surface
  ctx.strokeStyle = "#505050";
  ctx.lineWidth   = TRACK_WIDTH;
  ctx.lineCap     = "round";
  ctx.lineJoin    = "round";
  ctx.beginPath();
  ctx.moveTo(CENTERLINE[0].x, CENTERLINE[0].y);
  for (var i = 1; i < CENTERLINE.length; i++) {
    ctx.lineTo(CENTERLINE[i].x, CENTERLINE[i].y);
  }
  ctx.closePath();
  ctx.stroke();

  // Outer kerb (white border)
  ctx.strokeStyle = "rgba(200,200,200,0.7)";
  ctx.lineWidth   = TRACK_WIDTH + 4;
  ctx.beginPath();
  ctx.moveTo(CENTERLINE[0].x, CENTERLINE[0].y);
  for (var i = 1; i < CENTERLINE.length; i++) {
    ctx.lineTo(CENTERLINE[i].x, CENTERLINE[i].y);
  }
  ctx.closePath();
  ctx.stroke();

  // Redraw track surface over kerb
  ctx.strokeStyle = "#505050";
  ctx.lineWidth   = TRACK_WIDTH;
  ctx.beginPath();
  ctx.moveTo(CENTERLINE[0].x, CENTERLINE[0].y);
  for (var i = 1; i < CENTERLINE.length; i++) {
    ctx.lineTo(CENTERLINE[i].x, CENTERLINE[i].y);
  }
  ctx.closePath();
  ctx.stroke();

  // Dashed centre line
  ctx.strokeStyle  = "rgba(255,255,255,0.15)";
  ctx.lineWidth    = 1.5;
  ctx.lineCap      = "butt";
  ctx.setLineDash([16, 14]);
  ctx.beginPath();
  ctx.moveTo(CENTERLINE[0].x, CENTERLINE[0].y);
  for (var i = 1; i < CENTERLINE.length; i++) {
    ctx.lineTo(CENTERLINE[i].x, CENTERLINE[i].y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);

  // Start / finish line
  drawStartLine(ctx);
}

function drawStartLine(ctx) {
  var sx = CENTERLINE[0].x;
  var sy = CENTERLINE[0].y;

  // Compute the tangent at the start using the Catmull-Rom formula:
  // m[0] = 0.5 * (p[1] - p[n-1])  (closed loop)
  var n   = CTRL_POINTS.length;
  var pm1 = CTRL_POINTS[n - 1];
  var p1  = CTRL_POINTS[1];
  var tdx = 0.5 * (p1.x - pm1.x);
  var tdy = 0.5 * (p1.y - pm1.y);
  var tlen = Math.sqrt(tdx * tdx + tdy * tdy);

  // Perpendicular unit vector (rotate tangent 90° clockwise)
  var px = -tdy / tlen;
  var py =  tdx / tlen;

  var hw = TRACK_WIDTH / 2 - 2;  // stop just inside the track edge

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth   = 4;
  ctx.lineCap     = "butt";
  ctx.beginPath();
  ctx.moveTo(sx + px * hw, sy + py * hw);
  ctx.lineTo(sx - px * hw, sy - py * hw);
  ctx.stroke();
}


// ============================================================
// CAR PHYSICS CONSTANTS
// ============================================================
var MAX_SPEED        = 2.0;
var GRASS_MULTIPLIER = 0.22;   // grass is very slow — not worth cutting through
var TURN_RATE        = 0.025;   // tighter cornering
var MAX_GRASS_FRAMES = 160;
var MAX_STUCK_FRAMES = 220;

// Lerp rates for smooth acceleration / deceleration
var ACCEL_RATE = 0.008;   // how quickly speed approaches max when accelerating
var BRAKE_RATE = 0.14;    // how quickly speed drops when braking
var COAST_RATE = 0.035;   // passive coast-down rate


// ============================================================
// CAR
// ============================================================
function Car(brain) {
  this.x     = START_X;
  this.y     = START_Y;
  this.angle = START_ANGLE;
  this.speed = 0;
  this.brain = brain || null;

  this.alive       = true;
  this.grassFrames = 0;
  this.stuckFrames = 0;
  this.timeAlive   = 0;

  // Progress tracking
  this._prevCLIdx      = nearestCenterlineIdx(this.x, this.y);
  this._cumProgress    = 0;
  this.laps            = 0;
  this.progress        = 0;

  // Stats
  this.speedSum  = 0;
  this.avgSpeed  = 0;
  this.grassTime = 0;
  this.fitness   = 0;

  // Lap timing
  this.lapStartFrame  = 0;
  this.currentLapTime = 0;
  this.bestLapTime    = Infinity;
  this._prevLaps      = 0;

  // Last control inputs (used to drive the input display)
  this.lastControls = { accelerate: false, brake: false, left: false, right: false };
}

Car.prototype.getSensors = function() {
  var sensors = [];
  for (var i = 0; i < SENSOR_ANGLES.length; i++) {
    sensors.push(castRay(this.x, this.y, this.angle + SENSOR_ANGLES[i]));
  }
  return sensors;
};

Car.prototype.think = function() {
  if (!this.brain) return null;
  var sensors = this.getSensors();
  var inputs  = sensors.concat([this.speed / MAX_SPEED]);
  var out     = this.brain.forward(inputs);
  return {
    accelerate: out[0] > 0,
    brake:      out[1] > 0,
    left:       out[2] > 0,
    right:      out[3] > 0
  };
};

Car.prototype.update = function(controls) {
  if (!this.alive) return;
  this.lastControls = controls || { accelerate: false, brake: false, left: false, right: false };

  var onGrass  = isGrassAt(this.x, this.y);
  var topSpeed = onGrass ? MAX_SPEED * GRASS_MULTIPLIER : MAX_SPEED;

  // ---- Smooth speed control (lerp-based) --------------------
  //
  // Instead of adding a fixed acceleration value each frame,
  // the speed gradually approaches the target using linear
  // interpolation. This gives smoother acceleration and
  // braking curves that feel more like a real car.

  if (controls.accelerate && !controls.brake) {
    // Smoothly accelerate toward the speed limit
    this.speed += (topSpeed - this.speed) * ACCEL_RATE;

  } else if (controls.brake && this.speed > 0.1) {
    // Braking from forward motion: smoothly decelerate to zero
    this.speed += (0 - this.speed) * BRAKE_RATE;

  } else if (controls.brake && this.speed <= 0.1) {
    // Holding brake when stopped: allow gentle reverse
    this.speed += (-topSpeed * 0.28 - this.speed) * ACCEL_RATE;

  } else {
    // Coasting: passive friction slows the car gradually
    this.speed += (0 - this.speed) * COAST_RATE;
  }

  this.speed = Math.max(-topSpeed * 0.35, Math.min(topSpeed, this.speed));

  // ---- Turning ----------------------------------------------
  // Full turning ability is reached at 30% of max speed so the car
  // can navigate tight corners without needing to be at full pace.
  // Below that threshold turning scales with speed so stopped cars
  // cannot spin in place.
  var turnSf = Math.min(1.0, Math.abs(this.speed) / (MAX_SPEED * 0.30));
  if (turnSf > 0.05) {
    if (controls.left)  this.angle -= TURN_RATE * turnSf;
    if (controls.right) this.angle += TURN_RATE * turnSf;
  }

  // ---- Move -------------------------------------------------
  this.x += Math.cos(this.angle) * this.speed;
  this.y += Math.sin(this.angle) * this.speed;

  // ---- Progress tracking ------------------------------------
  var curIdx = nearestCenterlineIdx(this.x, this.y);
  var n      = CENTERLINE.length;
  var delta  = curIdx - this._prevCLIdx;
  if (delta >  n / 2) delta -= n;
  if (delta < -n / 2) delta += n;
  this._cumProgress   += delta;
  this._prevCLIdx      = curIdx;
  this.laps     = Math.max(0, Math.floor(this._cumProgress / n));
  this.progress = this._cumProgress;

  // ---- Stats ------------------------------------------------
  this.timeAlive++;
  this.speedSum += Math.abs(this.speed);
  this.avgSpeed  = this.speedSum / this.timeAlive;
  if (onGrass) this.grassTime++;

  // ---- Lap timing -------------------------------------------
  this.currentLapTime = this.timeAlive - this.lapStartFrame;
  if (this.laps > this._prevLaps) {
    if (this.currentLapTime < this.bestLapTime) {
      this.bestLapTime = this.currentLapTime;
    }
    this.lapStartFrame = this.timeAlive;
    this._prevLaps     = this.laps;
  }

  // ---- Death conditions -------------------------------------
  if (onGrass) {
    this.grassFrames++;
    if (this.grassFrames > MAX_GRASS_FRAMES) { this.alive = false; return; }
  } else {
    this.grassFrames = Math.max(0, this.grassFrames - 4);
  }

  // Going strongly backward
  if (this._cumProgress < -(n * 0.15)) { this.alive = false; return; }

  // Stuck (barely moving for too long)
  if (Math.abs(this.speed) < 0.22 && this.timeAlive > 100) {
    this.stuckFrames++;
    if (this.stuckFrames > MAX_STUCK_FRAMES) { this.alive = false; return; }
  } else {
    this.stuckFrames = 0;
  }
};

Car.prototype.draw = function(ctx, color, alpha) {
  if (!this.alive) return;
  color = color || "#3b82f6";
  alpha = (alpha !== undefined) ? alpha : 1.0;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(this.x, this.y);
  ctx.rotate(this.angle);

  ctx.fillStyle   = color;
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.roundRect(-7, -4.5, 14, 9, 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath();
  ctx.roundRect(0, -3.5, 5.5, 7, 1);
  ctx.fill();

  ctx.restore();
};

Car.prototype.drawSensors = function(ctx) {
  if (!this.alive) return;
  for (var i = 0; i < SENSOR_ANGLES.length; i++) {
    var da   = SENSOR_ANGLES[i];
    var dist = castRay(this.x, this.y, this.angle + da) * SENSOR_MAX;
    var ex   = this.x + Math.cos(this.angle + da) * dist;
    var ey   = this.y + Math.sin(this.angle + da) * dist;

    ctx.strokeStyle = "rgba(255,220,50,0.55)";
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    ctx.fillStyle = "#ffdc32";
    ctx.beginPath();
    ctx.arc(ex, ey, 2, 0, Math.PI * 2);
    ctx.fill();
  }
};


// ============================================================
// NEURAL NETWORK
// ============================================================
function NeuralNetwork(sizes) {
  sizes = sizes || [6, 8, 4];
  this.sizes   = sizes;
  this.weights = [];
  this.biases  = [];

  for (var i = 1; i < sizes.length; i++) {
    var lw = [], lb = [];
    for (var j = 0; j < sizes[i]; j++) {
      var row = [];
      for (var k = 0; k < sizes[i-1]; k++) {
        row.push((Math.random() * 2 - 1) * 0.6);
      }
      lw.push(row);
      lb.push((Math.random() * 2 - 1) * 0.1);
    }
    this.weights.push(lw);
    this.biases.push(lb);
  }
}

NeuralNetwork.prototype.forward = function(inputs) {
  var cur = inputs.slice();
  for (var l = 0; l < this.weights.length; l++) {
    var next = [];
    for (var j = 0; j < this.weights[l].length; j++) {
      var s = this.biases[l][j];
      for (var k = 0; k < cur.length; k++) s += cur[k] * this.weights[l][j][k];
      next.push(Math.tanh(s));
    }
    cur = next;
  }
  return cur;
};

NeuralNetwork.prototype.clone = function() {
  var nn = new NeuralNetwork(this.sizes);
  nn.weights = this.weights.map(function(l) { return l.map(function(r) { return r.slice(); }); });
  nn.biases  = this.biases.map(function(l) { return l.slice(); });
  return nn;
};

NeuralNetwork.prototype.mutate = function(rate, strength) {
  rate     = (rate     !== undefined) ? rate     : 0.12;
  strength = (strength !== undefined) ? strength : 0.35;
  this.weights = this.weights.map(function(l) {
    return l.map(function(r) {
      return r.map(function(w) {
        return Math.random() < rate ? w + (Math.random() * 2 - 1) * strength : w;
      });
    });
  });
  this.biases = this.biases.map(function(l) {
    return l.map(function(b) {
      return Math.random() < rate ? b + (Math.random() * 2 - 1) * strength : b;
    });
  });
  return this;
};

NeuralNetwork.prototype.crossover = function(other) {
  var child = this.clone();
  child.weights = child.weights.map(function(l, i) {
    return l.map(function(r, j) {
      return r.map(function(w, k) {
        return Math.random() < 0.5 ? w : other.weights[i][j][k];
      });
    });
  });
  child.biases = child.biases.map(function(l, i) {
    return l.map(function(b, j) {
      return Math.random() < 0.5 ? b : other.biases[i][j];
    });
  });
  return child;
};


// ============================================================
// GENETIC TRAINER
// ============================================================
var POPULATION_SIZE   = 20;
var ELITE_COUNT       = 4;
var MUTATION_RATE     = 0.12;
var MUTATION_STRENGTH = 0.35;
var MAX_GEN_FRAMES    = 20 * 60;  // 20 seconds per generation

function GeneticTrainer() {
  this.generation  = 0;
  this.frameCount  = 0;
  this.cars        = [];
  this.allTimeBest = 0;
  this.bestBrain   = null;
  this.history     = [];
  this._watchCar   = null;
  this._startGeneration();
}

GeneticTrainer.prototype.update = function() {
  this.frameCount++;

  for (var i = 0; i < this.cars.length; i++) {
    var car = this.cars[i];
    if (!car.alive) continue;
    var controls = car.think();
    car.update(controls);
    car.fitness = computeFitness(car);
  }

  var allDead = true;
  for (var i = 0; i < this.cars.length; i++) {
    if (this.cars[i].alive) { allDead = false; break; }
  }
  if (allDead || this.frameCount >= MAX_GEN_FRAMES) this._evolve();

  if (this._watchCar) {
    var wc = this._watchCar;
    wc.update(wc.think());
    if (!wc.alive) this._watchCar = this._freshWatchCar();
  }
};

Object.defineProperty(GeneticTrainer.prototype, "bestCar", {
  get: function() {
    var best = this.cars[0];
    for (var i = 1; i < this.cars.length; i++) {
      if (this.cars[i].fitness > best.fitness) best = this.cars[i];
    }
    return best;
  }
});

Object.defineProperty(GeneticTrainer.prototype, "watchCar", {
  get: function() {
    if (!this._watchCar && this.bestBrain) this._watchCar = this._freshWatchCar();
    return this._watchCar;
  }
});

GeneticTrainer.prototype._freshWatchCar = function() {
  return this.bestBrain ? new Car(this.bestBrain.clone()) : null;
};

GeneticTrainer.prototype._evolve = function() {
  for (var i = 0; i < this.cars.length; i++) {
    this.cars[i].fitness = computeFitness(this.cars[i]);
  }
  this.cars.sort(function(a, b) { return b.fitness - a.fitness; });

  var top = this.cars[0].fitness;
  this.history.push(top);

  if (top > this.allTimeBest) {
    this.allTimeBest = top;
    this.bestBrain   = this.cars[0].brain.clone();
    this._watchCar   = this._freshWatchCar();
  }

  var newBrains = [];
  for (var i = 0; i < ELITE_COUNT && i < this.cars.length; i++) {
    newBrains.push(this.cars[i].brain.clone());
  }
  while (newBrains.length < POPULATION_SIZE) {
    var ia    = Math.floor(Math.random() * ELITE_COUNT);
    var ib    = Math.floor(Math.random() * ELITE_COUNT);
    var child = this.cars[ia].brain.crossover(this.cars[ib].brain).mutate();
    newBrains.push(child);
  }

  this._startGeneration(newBrains);
};

GeneticTrainer.prototype._startGeneration = function(brains) {
  this.generation++;
  this.frameCount = 0;
  var self = this;
  this.cars = [];
  for (var i = 0; i < POPULATION_SIZE; i++) {
    var brain;
    if (brains) {
      brain = brains[i];
    } else if (self.bestBrain && i > 0) {
      brain = self.bestBrain.clone().mutate();
    } else if (self.bestBrain) {
      brain = self.bestBrain.clone();
    } else {
      brain = new NeuralNetwork();
    }
    this.cars.push(new Car(brain));
  }
};

// ============================================================
// INPUT DISPLAY
// Draws a small arrow-key widget showing which controls are
// currently active. Call from the render function.
// ============================================================
function drawInputDisplay(ctx, controls, x, y) {
  if (!controls) return;

  var bw = 26, bh = 22, gap = 3, r = 4;

  function drawBtn(bx, by, label, active) {
    ctx.fillStyle   = active ? "#facc15" : "rgba(0,0,0,0.45)";
    ctx.strokeStyle = active ? "#f59e0b" : "rgba(255,255,255,0.18)";
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, r);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle    = active ? "#000000" : "rgba(255,255,255,0.55)";
    ctx.font         = "bold 13px sans-serif";
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, bx + bw / 2, by + bh / 2);
  }

  // Top row: accelerate (centred above the bottom three)
  drawBtn(x + bw + gap, y,            "↑", controls.accelerate);
  // Bottom row: left, brake, right
  drawBtn(x,            y + bh + gap, "←", controls.left);
  drawBtn(x + bw + gap, y + bh + gap, "↓", controls.brake);
  drawBtn(x + (bw + gap) * 2, y + bh + gap, "→", controls.right);
}


// ============================================================
// LAP TIME FORMATTING
// ============================================================
function formatTime(frames) {
  var total = frames / 60;
  var mins  = Math.floor(total / 60);
  var secs  = Math.floor(total % 60);
  var ms    = Math.floor((total - Math.floor(total)) * 1000);
  var s     = String(secs).padStart(2, "0") + "." + String(ms).padStart(3, "0");
  return mins > 0 ? mins + ":" + s : s;
}