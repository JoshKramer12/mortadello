import assert from 'node:assert/strict';
import test from 'node:test';
import { canPlayCards, getActivePileState, pickupPile, resolvePlay } from '../lib/game-server.mjs';

const card = (rank, suit = 'clubs') => ({ id: `${rank}-${suit}`, rank, suit });
const state = ({ hand = [], faceUp = [], drawPile = [], discard = [card('7')], version = 1 } = {}) => ({
  id: 'ROOM', version, activePlayer: 'p1', message: 'Game started', drawPile, discard,
  players: [
    { id: 'p1', hand, faceUp, faceDown: [card('9', 'hearts')] },
    { id: 'p2', hand: [card('4', 'spades')], faceUp: [], faceDown: [] },
  ],
});

test('face-up cards cannot be played while the player still has a hand', () => {
  const current = state({ hand: [card('8', 'diamonds')], faceUp: [card('8', 'hearts')] });
  assert.throws(() => resolvePlay(current, 'p1', ['8-hearts'], 1), /ILLEGAL_PLAY/);
});

test('face-up cards become playable after the hand is empty and draw pile is empty', () => {
  const next = resolvePlay(state({ faceUp: [card('8', 'hearts')] }), 'p1', ['8-hearts'], 1);
  assert.deepEqual(next.players[0].faceUp, []);
  assert.deepEqual(next.discard.map((played) => played.id), ['7-clubs', '8-hearts']);
});

test('face-up cards remain unavailable until the draw pile is empty', () => {
  const current = state({ faceUp: [card('8', 'hearts')], drawPile: [card('6', 'spades')] });
  assert.throws(() => resolvePlay(current, 'p1', ['8-hearts'], 1), /ILLEGAL_PLAY/);
});

test('matching face-up cards can be played together', () => {
  const next = resolvePlay(state({ faceUp: [card('8', 'hearts'), card('8', 'spades'), card('K', 'diamonds')] }), 'p1', ['8-hearts', '8-spades'], 1);
  assert.deepEqual(next.players[0].faceUp.map((remaining) => remaining.id), ['K-diamonds']);
  assert.deepEqual(next.discard.map((played) => played.id), ['7-clubs', '8-hearts', '8-spades']);
});

test('picking up blocks face-up cards until the new hand is emptied', () => {
  const pickedUp = pickupPile(state({ faceUp: [card('8', 'hearts')], discard: [card('7'), card('3', 'diamonds')] }), 'p1', 1);
  assert.equal(pickedUp.players[0].hand.length, 2);
  assert.throws(() => resolvePlay(pickedUp, 'p1', ['8-hearts'], 2), /ILLEGAL_PLAY/);
  const handCleared = { ...pickedUp, version: 3, players: pickedUp.players.map((player) => player.id === 'p1' ? { ...player, hand: [] } : player) };
  assert.deepEqual(resolvePlay(handCleared, 'p1', ['8-hearts'], 3).players[0].faceUp, []);
});

test('transparent threes preserve the comparison card and remain in the discard pile', () => {
  const discard = [card('K'), card('3', 'diamonds'), card('3', 'hearts')];
  assert.equal(getActivePileState(discard).effectiveRank, 'K');
  assert.equal(canPlayCards(discard, [card('Q', 'spades')]), false);
  assert.equal(canPlayCards(discard, [card('A', 'spades')]), true);
  assert.equal(discard.length, 3);
});
