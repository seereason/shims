var h$CC_MAIN       = h$registerCC("MAIN", "MAIN", "<built-in>", false);
var h$CC_SYSTEM     = h$registerCC("SYSTEM", "SYSTEM", "<built-in>", false);
var h$CC_GC         = h$registerCC("GC", "GC", "<built-in>", false);
var h$CC_OVERHEAD   = h$registerCC("OVERHEAD_of", "PROFILING", "<built-in>", false);
var h$CC_DONT_CARE  = h$registerCC("DONT_CARE", "MAIN", "<built-in>", false);
var h$CC_PINNED     = h$registerCC("PINNED", "SYSTEM", "<built-in>", false);
var h$CC_IDLE       = h$registerCC("IDLE", "IDLE", "<built-in>", false);

var h$CCS_MAIN      = h$registerCCS(h$CC_MAIN);
var h$CCS_SYSTEM    = h$registerCCS(h$CC_SYSTEM);
var h$CCS_GC        = h$registerCCS(h$CC_GC);
var h$CCS_OVERHEAD  = h$registerCCS(h$CC_OVERHEAD);
var h$CCS_DONT_CARE = h$registerCCS(h$CC_DONT_CARE);
var h$CCS_PINNED    = h$registerCCS(h$CC_PINNED);
var h$CCS_IDLE      = h$registerCCS(h$CC_IDLE);

var h$curCCS = h$CCS_MAIN;

var h$ccList  = [];
var h$ccsList = [];

function h$getCurrentCostCentre() {
  return h$curCCS;
}

function h$mkCC(label, module, srcloc, isCaf) {
  console.log("h$mkCC(", label, ", ", module, ", ", srcloc, ", ", isCaf, ")");
  return { label: label, module: module, srcloc: srcloc, isCaf: isCaf,
           memAlloc: 0, timeTicks: 0 };
}

function h$mkCCS(cc) {
  console.log("h$mkCCS(", cc, ")");
  return { cc: cc, sccCount: 0, timeTicks: 0, memAlloc: 0, inheritedTicks: 0,
           inheritedAlloc: 0, prevStack: null, root: null, depth: 0 };
}

function h$registerCC(label, module, srcloc, isCaf) {
  var cc = mkCC(label, module, srcloc, isCaf);
  h$ccList.push(cc);
  return cc;
}

function h$registerCCS(cc) {
  var ccs = h$mkCCS(cc);
  h$ccsList.push(ccs);
  return ccs;
}

function h$enterFunCCS(ccsapp, ccsfn) {
  // common case 1: both stacks are the same
  if (ccsapp === ccsfn) {
    return;
  }

  // common case 2: the function stack is empty, or just CAF
  if (ccsfn.prevStack === h$CCS_MAIN) {
    return;
  }

  // FIXME: do we need this?
  h$curCCS = h$CC_OVERHEAD;

  // common case 3: the stacks are completely different (e.g. one is a
  // descendent of MAIN and the other of a CAF): we append the whole
  // of the function stack to the current CCS.
  if (ccsfn.root !== ccsapp.root) {
    h$curCCS = h$appendCCS(ccsapp, ccsfn);
    return;
  }

  // uncommon case 4: ccsapp is deeper than ccsfn
  if (ccsapp.depth > ccsfn.depth) {
    var tmp = ccsapp;
    var dif = ccsapp.depth - ccsfn.depth;
    for (var i = 0; i < dif; i++) {
      tmp = tmp.prevStack;
    }
    h$curCCS = h$enterFunEqualStacks(ccsapp, tmp, ccsfn);
    return;
  }

  // uncommon case 5: ccsfn is deeper than CCCS
  if (ccsfn.depth > ccsapp.depth) {
    h$curCCS = h$enterFunCurShorter(ccsapp, ccsfn, ccsfn.depth - ccsapp.depth);
    return;
  }

  // uncommon case 6: stacks are equal depth, but different
  h$curCCS = h$enterFunEqualStacks(ccsapp, ccsapp, ccsfn);
}

function h$enterFunCurShorter(ccsapp, ccsfn, n) {
  if (n === 0) {
    assert(ccsapp.length === ccsfn.length);
    return h$enterFunEqualStacks(ccsapp, ccsapp, ccsfn);
  } else {
    assert(ccsfn.depth > ccsapp.depth);
    return h$pushCostCentre(h$enterFunCurShorter(ccsapp, ccsfn.prevStack, n-1), ccsfn.cc);
  }
}

function h$enterFunEqualStacks(ccs0, ccsapp, ccsfn) {
  assert(ccsapp.depth === ccsfn.depth);
  if (ccsapp === ccsfn) return ccs0;
  return h$pushCostCentre(h$enterFunEqualStacks(ccs0, ccsapp.prevStack, ccsfn.prevStack), ccsfn.cc);
}

function h$pushCostCentre(ccs, cc) {
  if (ccs.cc === cc) {
    return ccs;
  } else {
    var temp_ccs = h$checkLoop(ccs, cc);
    if (temp_ccs !== null) {
      return temp_ccs;
    }
    return h$actualPush(ccs, cc);
  }
}

function h$checkLoop(ccs, cc) {
  while (ccs !== null) {
    if (ccs.cc === cc)
      return ccs;
    ccs = cc.prevStack;
  }
  return null;
}

function h$actualPush(ccs, cc) {
  var new_ccs = {};

  new_ccs.cc = cc;
  new_ccs.prevStack = ccs;
  new_ccs.root = ccs.root;
  new_ccs.depth = ccs.depth + 1;
  new_ccs.sccCount = 0;
  new_ccs.timeTicks = 0;
  new_ccs.memAlloc = 0;
  new_ccs.inheritedTicks = 0;
  new_ccs.inheritedAlloc = 0;

  return new_ccs;
}

//
// emulating pointers for cost-centres and cost-centre stacks
//

var h$ccsCC_offset     = 8;  // ccs->cc
var h$ccsPrevStackOffset = 16; // ccs->prevStack

var h$ccLabel_offset   = 8;  // cc->label
var h$ccModule_offset  = 16; // cc->module
var h$ccsrcloc_offset  = 24; // cc->srcloc

function h$buildCCPtr(o) {
  console.log("buildCCPtr called");
  // last used offset is 24, so we need to allocate 32 bytes
  var cc = h$newByteArray(32);
  cc.myTag = "cc pointer";
  cc.arr = [];
  cc.arr[h$ccLabel_offset]  = [h$encodeUtf8(o.label),   0];
  cc.arr[h$ccModule_offset] = [h$encodeUtf8(o.module),  0];
  cc.arr[h$ccsrcloc_offset] = [h$encodeUtf8(o.srcloc),  0];
  console.log("returning cc:", cc);
  return cc;
}

function h$buildCCSPtr(o) {
  console.log("buildCCSPtr called", o);
  // last used offset is 16, allocate 24 bytes
  var ccs = h$newByteArray(24);
  ccs.myTag = "ccs pointer";
  ccs.arr = [];
  if (o.prevStack !== null) {
    ccs.arr[h$ccsPrevStackOffset] = h$buildCCSPtr(o.prevStack);
  }
  ccs.arr[h$ccsCC_offset] = [h$buildCCPtr(o.cc), 0];
  console.log("returning ccs:", ccs);
  return ccs;
}
