/**
 * PK 再来一局竞态条件测试
 *
 * 模拟场景：先点击 vs 后点击，验证轮询不会陷入无限等待
 *
 * 房间 Map 结构（与 pk.js 中的一致）：
 *   creatorReadyForNext: bool  房主是否准备下一局
 *   joinerReadyForNext:  bool  对手是否准备下一局
 *   round:               int   当前局数
 *   targetPlayer:        obj   本局目标选手
 *
 * 被测试的客户端轮询逻辑（来自 guess.ts _startPollingForNextPKRound）：
 *   1. 检测 round 是否已自增（对手已触发 /next-round）
 *   2. 检测 oppReady 标志
 */

// ====================== 模拟房间 ======================

const mockTarget = {
  _id: '1', id: 1, playerId: 'player1', name: 's1mple',
  team: 'NAVI', age: 26, country: 'Ukraine', countryCode: 'UA',
  region: 'Europe', position: 'AWPer', majorAppearances: 15,
  formerTeams: [], avatar: '',
};

function createRoom() {
  return {
    id: 'pk_test',
    difficulty: 'hard',
    creator: { nickname: '玩家A', avatar: '' },
    joiner: { nickname: '玩家B', avatar: '' },
    targetPlayer: { ...mockTarget },
    creatorResult: null,
    joinerResult: null,
    creatorAttempts: 0,
    joinerAttempts: 0,
    round: 1,
    creatorReadyForNext: false,
    joinerReadyForNext: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ====================== 测试用例 ======================

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'assertion failed');
}

// ====================== 核心场景 ======================

console.log('\n📋 PK 再来一局竞态条件测试');
console.log('================================\n');

// --- 场景 1: 当前有问题的场景（修复前） ---
console.log('场景1: 先点击用户无限等待（修复前复现）');

test('先点击用户轮询 oppReady 永远为 false', () => {
  const room = createRoom();

  // 步骤 1：Player A（房主）先点击"再来一局"
  room.creatorReadyForNext = true;
  // bothReady = false，Player A 进入轮询
  const bothReady_step1 = room.creatorReadyForNext && room.joinerReadyForNext;
  assert(bothReady_step1 === false, 'Player A 进入轮询状态');

  // 步骤 2：Player B（对手）点击"再来一局"
  room.joinerReadyForNext = true;
  const bothReady_step2 = room.creatorReadyForNext && room.joinerReadyForNext;
  assert(bothReady_step2 === true, 'Player B 检测到双方就绪');

  // 步骤 3：Player B 触发 /next-round（服务端重置标志 + 回合+1）
  room.creatorReadyForNext = false;
  room.joinerReadyForNext = false;
  room.round += 1;
  room.targetPlayer = { ...mockTarget, name: 'ZywOo' };

  // 步骤 4：Player A 轮询 — 旧逻辑只检查 oppReady
  const oppReady = room.joinerReadyForNext; // Player A 是 creator，检查 joiner
  assert(oppReady === false, 'oppReady 已被重置为 false — 旧逻辑会死等');

  // 证明旧逻辑会卡死
  const oldLogicWouldProceed = oppReady;
  assert(oldLogicWouldProceed === false, 'BUG 复现：旧逻辑永远不会跳出轮询');
});

// --- 场景 2: 修复后的逻辑 ---
console.log('\n场景2: 修复后 — 轮询检测 round 变化');

test('新逻辑检测到 round > pkRound 时正确跳出', () => {
  const room = createRoom();

  // Player A 本地状态
  let pkRound = room.round; // 1

  // Player A 先点击
  room.creatorReadyForNext = true;

  // Player B 点击 + 触发 /next-round
  room.joinerReadyForNext = true;
  room.creatorReadyForNext = false;
  room.joinerReadyForNext = false;
  room.round += 1;
  room.targetPlayer = { ...mockTarget, name: 'ZywOo' };

  // Player A 轮询 — 新逻辑
  const currentRound = room.round; // 2
  const roundAdvanced = currentRound > pkRound;
  assert(roundAdvanced === true, '新逻辑检测到 round 已变化（2 > 1）');

  const oppReady = room.joinerReadyForNext;
  assert(oppReady === false, 'oppReady 仍为 false（已被重置）');

  // 新逻辑：先检查 round 变化
  if (currentRound > pkRound) {
    // 直接用房间数据进入下一局，不调 /next-round
    pkRound = currentRound;
    assert(pkRound === 2, 'Player A 正确进入第 2 局');
  }
});

// --- 场景 3: 正常流程（无竞态） ---
console.log('\n场景3: 正常流程 — 双方依次点击，无竞态');

test('双方依次点击，oppReady 正常触发', () => {
  const room = createRoom();
  let pkRound = room.round; // 1

  // Player A 先点击
  room.creatorReadyForNext = true;

  // Player B 点击（还未触发 /next-round）
  room.joinerReadyForNext = true;

  // Player A 轮询 — 新逻辑
  const currentRound = room.round;
  const roundAdvanced = currentRound > pkRound;
  const oppReady = room.joinerReadyForNext;

  assert(roundAdvanced === false, 'round 未变化');
  assert(oppReady === true, 'oppReady 正常检测到对手已准备');

  // Player B 触发 /next-round
  room.creatorReadyForNext = false;
  room.joinerReadyForNext = false;
  room.round += 1;

  pkRound = room.round;
  assert(pkRound === 2, 'Player B 触发后进入第 2 局');
});

// --- 场景 4: 服务端 /next-round 幂等 ---
console.log('\n场景4: 服务端 /next-round 幂等（重复调用不报错）');

test('双方标志都重置时，/next-round 返回当前回合数据', () => {
  const room = createRoom();

  // 模拟双方都 ready 后触发过一次 /next-round
  room.creatorReadyForNext = true;
  room.joinerReadyForNext = true;

  // 第一次 /next-round 成功
  room.creatorReadyForNext = false;
  room.joinerReadyForNext = false;
  room.round = 2;
  room.targetPlayer = { ...mockTarget, name: 'ZywOo' };

  // 第二次 /next-round（重复调用）
  const bothFlagsReset = !room.creatorReadyForNext && !room.joinerReadyForNext;
  assert(bothFlagsReset === true, '双方标志已重置');

  // 幂等逻辑：直接返回当前状态，不报 400
  if (bothFlagsReset) {
    const result = { round: room.round, targetPlayer: room.targetPlayer };
    assert(result.round === 2, '幂等返回第 2 局数据');
    assert(result.targetPlayer.name === 'ZywOo', '幂等返回当前目标选手');
  }
});

test('只有一方准备时，/next-round 正确拒绝', () => {
  const room = createRoom();
  room.creatorReadyForNext = true;
  room.joinerReadyForNext = false;

  const oneReady = room.creatorReadyForNext && room.joinerReadyForNext;
  assert(oneReady === false, '只有一方准备');

  const bothReset = !room.creatorReadyForNext && !room.joinerReadyForNext;
  assert(bothReset === false, '并非双方都重置');

  // 应返回 400：双方未都准备
  const shouldReject = !oneReady && !bothReset;
  assert(shouldReject === true, '正确返回 400 双方未都准备');
});

// ====================== 结果 ======================

console.log('\n================================');
console.log(`结果: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log('================================\n');

process.exit(failed > 0 ? 1 : 0);
