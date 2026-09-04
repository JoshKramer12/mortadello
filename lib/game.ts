/** Server-authoritative Mortadello rules. UI code only renders projections of this state. */
export type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';
export type Card = { id: string; rank: Rank; suit: Suit };
export type PlayerState = { id: string; hand: Card[]; faceUp: Card[]; faceDown: Card[] };
export type GameState = { id: string; version: number; players: [PlayerState, PlayerState]; drawPile: Card[]; discard: Card[]; activePlayer: string; winner?: string; message: string };

const ranks: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const normalRanks: Rank[] = ['4', '5', '6', '7', '8', '9', 'J', 'Q', 'K'];
const specials = new Set<Rank>(['2', '3', '10', 'A']);

export const makeDeck = (): Card[] => (['clubs', 'diamonds', 'hearts', 'spades'] as Suit[]).flatMap((suit) => ranks.map((rank) => ({ id: `${rank}-${suit}`, rank, suit })));
export const shuffle = (cards: Card[], random: () => number = Math.random) => { const out = [...cards]; for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; };

export function createGame(id: string, playerIds: [string, string], random?: () => number): GameState {
  const deck = shuffle(makeDeck(), random); const deal = () => deck.pop()!;
  const player = (id: string): PlayerState => ({ id, hand: [deal(), deal(), deal()], faceUp: [deal(), deal(), deal()], faceDown: [deal(), deal(), deal()] });
  return { id, version: 1, players: [player(playerIds[0]), player(playerIds[1])], drawPile: deck, discard: [], activePlayer: playerIds[0], message: 'Game started' };
}

export type ActivePileState = { effectiveRank?: Rank; requiresSpecial: boolean; reset: boolean };
export function getActivePileState(discard: Card[]): ActivePileState {
  for (let i = discard.length - 1; i >= 0; i--) {
    const rank = discard[i].rank;
    if (rank === '3') continue;
    if (rank === '2') return { requiresSpecial: false, reset: true };
    return { effectiveRank: rank, requiresSpecial: rank === 'A', reset: false };
  }
  return { requiresSpecial: false, reset: false };
}

function cardsForTurn(player: PlayerState, drawEmpty: boolean): { cards: Card[]; source: 'hand' | 'faceUp' | 'faceDown' } {
  if (player.hand.length) return { cards: player.hand, source: 'hand' };
  if (!drawEmpty) return { cards: [], source: 'hand' };
  if (player.faceUp.length) return { cards: player.faceUp, source: 'faceUp' };
  return { cards: player.faceDown, source: 'faceDown' };
}

export function canPlayCards(discard: Card[], cards: Card[]): boolean {
  if (!cards.length || cards.some((card) => card.rank !== cards[0].rank)) return false;
  const rank = cards[0].rank; const active = getActivePileState(discard);
  if (active.requiresSpecial) return specials.has(rank);
  if (specials.has(rank) || !active.effectiveRank || active.reset) return true;
  return normalRanks.indexOf(rank) >= normalRanks.indexOf(active.effectiveRank);
}

export function getLegalMoves(state: GameState, playerId: string): Card[] {
  if (state.winner || state.activePlayer !== playerId) return [];
  const player = state.players.find((item) => item.id === playerId); if (!player) return [];
  const turn = cardsForTurn(player, state.drawPile.length === 0);
  return turn.source === 'faceDown' ? [] : turn.cards.filter((card) => canPlayCards(state.discard, [card]));
}

function clone(state: GameState): GameState { return { ...state, players: state.players.map((player) => ({ ...player, hand: [...player.hand], faceUp: [...player.faceUp], faceDown: [...player.faceDown] })) as [PlayerState, PlayerState], drawPile: [...state.drawPile], discard: [...state.discard] }; }
function otherPlayer(state: GameState, playerId: string) { return state.players.find((player) => player.id !== playerId)!; }
function replenish(state: GameState, player: PlayerState) { while (player.hand.length < 3 && state.drawPile.length) player.hand.push(state.drawPile.pop()!); }
function sequenceCount(discard: Card[], rank: Rank) { let total = 0; for (let i = discard.length - 1; i >= 0; i--) { if (discard[i].rank === '3') continue; if (discard[i].rank !== rank) break; total++; } return total; }
function checkWinner(state: GameState, player: PlayerState) { if (!player.hand.length && !player.faceUp.length && !player.faceDown.length) { state.winner = player.id; state.message = `${player.id} wins!`; } }

export type MoveResult = { state: GameState; cleared: boolean; nextPlayer: string };
export function resolvePlay(current: GameState, playerId: string, cardIds: string[], expectedVersion: number): MoveResult {
  if (current.version !== expectedVersion) throw new Error('STALE_ACTION');
  if (current.winner) throw new Error('GAME_OVER'); if (current.activePlayer !== playerId) throw new Error('NOT_YOUR_TURN');
  const state = clone(current); const player = state.players.find((item) => item.id === playerId)!; const turn = cardsForTurn(player, state.drawPile.length === 0);
  if (turn.source === 'faceDown') throw new Error('USE_FACE_DOWN_ACTION');
  const played = turn.cards.filter((card) => cardIds.includes(card.id));
  if (played.length !== cardIds.length || !canPlayCards(state.discard, played)) throw new Error('ILLEGAL_PLAY');
  if (turn.source === 'hand') player.hand = player.hand.filter((card) => !cardIds.includes(card.id)); else player.faceUp = player.faceUp.filter((card) => !cardIds.includes(card.id));
  state.discard.push(...played); if (turn.source === 'hand') replenish(state, player);
  const rank = played[0].rank; const cleared = rank === '10' || sequenceCount(state.discard, rank) >= 4;
  if (cleared) { state.discard = []; state.activePlayer = playerId; state.message = rank === '10' ? '10 burned the pile — play again.' : 'Four of a kind — pile cleared!'; }
  else { state.activePlayer = otherPlayer(state, playerId).id; const active = getActivePileState(state.discard); state.message = rank === '2' ? 'Pile reset.' : rank === '3' ? `3 is transparent${active.effectiveRank ? ` — ${active.effectiveRank} remains active.` : '.'}` : rank === 'A' ? 'Special card required.' : 'Card played.'; }
  checkWinner(state, player); state.version++;
  return { state, cleared, nextPlayer: state.activePlayer };
}

export function resolveFaceDownAttempt(current: GameState, playerId: string, cardId: string, expectedVersion: number): MoveResult {
  if (current.version !== expectedVersion) throw new Error('STALE_ACTION'); if (current.activePlayer !== playerId) throw new Error('NOT_YOUR_TURN');
  const state = clone(current); const player = state.players.find((item) => item.id === playerId)!;
  if (state.drawPile.length || player.hand.length || player.faceUp.length) throw new Error('FACE_DOWN_NOT_AVAILABLE');
  const card = player.faceDown.find((item) => item.id === cardId); if (!card) throw new Error('CARD_UNAVAILABLE'); player.faceDown = player.faceDown.filter((item) => item.id !== cardId);
  if (!canPlayCards(state.discard, [card])) { player.hand.push(...state.discard, card); state.discard = []; state.activePlayer = playerId; state.version++; state.message = 'Face-down card could not be played — pick up the pile.'; return { state, cleared: false, nextPlayer: playerId }; }
  // Resolve the revealed legal card by placing it in a temporary hand to reuse the normal path.
  player.hand.push(card); return resolvePlay({ ...state, version: state.version }, playerId, [card.id], expectedVersion);
}

export function pickupPile(current: GameState, playerId: string, expectedVersion: number): GameState {
  if (current.version !== expectedVersion) throw new Error('STALE_ACTION'); if (current.activePlayer !== playerId) throw new Error('NOT_YOUR_TURN');
  const state = clone(current); const player = state.players.find((item) => item.id === playerId)!; if (!state.discard.length) throw new Error('EMPTY_PILE');
  player.hand.push(...state.discard); state.discard = []; state.activePlayer = playerId; state.version++; state.message = 'Pile picked up — start a new sequence.'; return state;
}

/** A client projection never includes another player’s cards or any face-down identities. */
export function projectForPlayer(state: GameState, playerId: string) {
  const player = state.players.find((item) => item.id === playerId); if (!player) throw new Error('NOT_A_PLAYER'); const opponent = otherPlayer(state, playerId);
  return { id: state.id, version: state.version, activePlayer: state.activePlayer, winner: state.winner, message: state.message, drawCount: state.drawPile.length, discard: state.discard, player, opponent: { id: opponent.id, handCount: opponent.hand.length, faceUp: opponent.faceUp, faceDownCount: opponent.faceDown.length } };
}
