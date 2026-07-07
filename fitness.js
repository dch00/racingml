// ============================================================
// FITNESS.JS -- How the AI learns what good driving looks like
//
// This is the only file you need to modify.
//
// computeFitness() is called every frame for each car and
// returns a number. Higher = better driver. The genetic
// algorithm keeps the cars with the highest scores and uses
// them to produce the next generation.
//
// The car object has these properties you can use:
//
//   car.progress    -- how far along the track the car has gone
//                      (measured in centerline steps, ~220 per lap)
//   car.laps        -- number of completed laps
//   car.timeAlive   -- frames the car has been running
//   car.avgSpeed    -- average speed over its lifetime (0 to 5)
//   car.grassTime   -- frames spent on grass (lower is better)
//   car.alive       -- whether the car is still running
//
// A lap is roughly 220 progress units (the number of centerline
// points that make up one circuit of the track).
//
// EXPERIMENTS TO TRY:
//   - Increase the lap bonus to encourage completing laps
//   - Remove the grass penalty and see if cars stay on track anyway
//   - Add a speed reward: car.avgSpeed * some_weight
//   - Try returning just car.progress and see how long it takes
// ============================================================

function computeFitness(car) {

  // Base score: how far around the track the car has traveled
  var progressScore = Math.max(0, car.progress);

  // Big bonus for completing full laps
  var lapBonus = car.laps * 300;

  // Small reward for staying alive longer
  var timeBonus = car.timeAlive * 0.01;

  // Heavy penalty for time spent on grass.
  // This needs to outweigh any progress gained by cutting corners.
  // Each frame on grass costs 1.5 points. Cutting a corner that
  // saves ~20 progress units but takes 30 frames on grass costs
  // 45 points -- far more than the 20 gained. Not worth it.
  var grassPenalty = car.grassTime * 1.5;

  return progressScore + lapBonus + timeBonus - grassPenalty;

}