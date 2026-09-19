// One run at a time.
//
// Run, Step, Verify and Run Transition all drive the same interpreter, and
// every one of them awaits the main process part way through. A second click,
// or a held F10, started a second run on top of the first: two runs of the
// hash puzzle both failed on an empty stack, and two clicks on Run Transition
// advanced the chain twice on one transaction.

var runBusy = false;

// Runs fn unless a run is already in flight, in which case it does nothing
// and returns undefined. The flag clears however fn ends.
async function runExclusive(fn) {
  if (runBusy) return undefined;
  runBusy = true;
  try {
    return await fn();
  } finally {
    runBusy = false;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runExclusive };
}
