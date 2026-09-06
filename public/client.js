/* Browser client: renders only server-sanitized room state. */
const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
let game = null, selected = [], roomCode = '', invite = '', opponentOnline = true;
const $ = (id) => document.getElementById(id);
const suit = { clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' };
const isRed = (cardData) => cardData.suit === 'diamonds' || cardData.suit === 'hearts';

function card(cardData, options = {}) {
  const interactive = Boolean(options.interactive);
  const stateClass = interactive ? 'card--interactive' : 'card--inactive';
  const sizeClass = `${options.compact ? 'card--compact' : ''} ${options.side ? 'card--side' : ''}`;
  if (options.back) {
    const faceDownAttribute = options.faceDown && interactive ? `data-facedown="${cardData.id}"` : '';
    return `<button class="card card--back ${stateClass} ${sizeClass}" ${faceDownAttribute} ${interactive ? '' : 'disabled'} aria-label="Face-down card"><span class="card__star">★</span></button>`;
  }
  if (!cardData) return '<div class="card card--empty"></div>';
  const selectedClass = interactive && selected.includes(cardData.id) ? 'card--selected' : '';
  const cardAttribute = interactive ? `data-card="${cardData.id}"` : '';
  return `<button class="card ${stateClass} ${sizeClass} ${selectedClass}" ${cardAttribute} ${interactive ? '' : 'disabled'} aria-label="${cardData.rank} of ${cardData.suit}"><span class="card__corner ${isRed(cardData) ? 'red' : ''}"><b>${cardData.rank}</b><small>${suit[cardData.suit]}</small></span><span class="card__suit ${isRed(cardData) ? 'red' : ''}">${suit[cardData.suit]}</span><span class="card__corner card__corner--bottom ${isRed(cardData) ? 'red' : ''}"><b>${cardData.rank}</b><small>${suit[cardData.suit]}</small></span></button>`;
}
function stack(cardData, options = {}) { return `<div class="stack">${card(null, { back: true })}${card(cardData, options)}</div>`; }
function playableSource() {
  if (!game) return { source: 'none', cards: [] };
  const { hand, faceUp, faceDown } = game.player;
  if (hand.length) return { source: 'hand', cards: hand };
  if (game.drawCount > 0) return { source: 'none', cards: [] };
  if (faceUp.length) return { source: 'faceUp', cards: faceUp };
  return { source: 'faceDown', cards: faceDown };
}
function discardDisplay(discard) {
  let activeIndex = discard.length - 1;
  while (activeIndex >= 0 && discard[activeIndex].rank === '3') activeIndex--;
  const transparent = discard.slice(activeIndex + 1);
  return { main: activeIndex >= 0 ? discard[activeIndex] : transparent.pop(), transparent };
}
function send(event, payload = {}) { socket.send(JSON.stringify({ event, payload })); }
function emit(event, payload) { if (game) send(event, { ...payload, version: game.version }); }
function message(text) { $('status').textContent = text; }
function render() {
  if (!game) return;
  $('lobby').hidden = true; $('game-shell').hidden = false;
  const mine = game.activePlayer === game.player.id && !game.winner;
  const source = playableSource();
  const selectedCards = source.cards.filter((cardData) => selected.includes(cardData.id));
  selected = selectedCards.map((cardData) => cardData.id);
  const matching = selectedCards.length > 0 && selectedCards.every((cardData) => cardData.rank === selectedCards[0].rank);
  $('turn').textContent = mine ? 'Your turn' : 'Opponent';
  $('opp-count').textContent = `${game.opponent.handCount} cards`; $('hand-count').textContent = `${game.player.hand.length} cards`;
  $('opp-hand').innerHTML = Array.from({ length: Math.min(game.opponent.handCount, 5) }, () => card(null, { back: true, compact: true })).join('');
  $('opp-table').innerHTML = game.opponent.faceUp.map((cardData) => stack(cardData)).join('');
  const discard = discardDisplay(game.discard);
  $('discard').innerHTML = card(discard.main); $('discard-side').innerHTML = discard.transparent.map((cardData) => card(cardData, { side: true })).join(''); $('draw-count').textContent = game.drawCount;
  const canUseFaceUp = mine && source.source === 'faceUp'; const canUseFaceDown = mine && source.source === 'faceDown';
  $('player-table').innerHTML = game.player.faceUp.length ? game.player.faceUp.map((cardData) => stack(cardData, { interactive: canUseFaceUp })).join('') : game.player.faceDown.map((cardData) => stack(cardData, { back: true, faceDown: true, interactive: canUseFaceDown })).join('');
  $('hand').innerHTML = game.player.hand.map((cardData) => card(cardData, { interactive: mine && source.source === 'hand' })).join('');
  $('play').disabled = !mine || source.source === 'faceDown' || !matching; $('play').textContent = matching ? 'Play selected' : mine ? 'Select a card' : 'Opponent’s turn'; $('pickup').disabled = !mine;
  message(game.winner ? (game.winner === game.player.id ? 'MORTADELLO — You Win!' : 'MORTADELLO — You Lost') : opponentOnline ? game.message : 'Opponent reconnecting…');
}
function selectCard(event) {
  const id = event.target.closest('[data-card]')?.dataset.card;
  if (!id || !game || game.activePlayer !== game.player.id) return;
  const source = playableSource(); const target = source.cards.find((cardData) => cardData.id === id);
  if (!target) return;
  if (selected.includes(id)) selected = selected.filter((selectedId) => selectedId !== id);
  else if (selected.length && source.cards.find((cardData) => cardData.id === selected[0])?.rank !== target.rank) selected = [id];
  else selected.push(id);
  render();
}
function store(code, playerToken) { localStorage.setItem(`mortadello:${code}`, playerToken); roomCode = code; invite = `${location.origin}/?room=${code}`; $('room-display').textContent = code; $('invite').textContent = invite; }
function join(code = roomCode) { const normalized = code.trim().toUpperCase(); if (normalized) send('room:join', { roomCode: normalized, playerToken: localStorage.getItem(`mortadello:${normalized}`) }); }
$('create').onclick = () => send('room:create', { origin: location.origin }); $('show-join').onclick = () => { $('lobby-actions').hidden = true; $('join-panel').hidden = false; }; $('join').onclick = () => join($('room-code').value); $('copy').onclick = () => navigator.clipboard.writeText(invite); $('hand').onclick = selectCard;
$('player-table').onclick = (event) => { selectCard(event); const id = event.target.closest('[data-facedown]')?.dataset.facedown; if (id) emit('game:faceDown', { cardId: id }); };
$('play').onclick = () => { if (selected.length) { emit('game:play', { cardIds: selected }); selected = []; } }; $('pickup').onclick = () => emit('game:pickup', {});
socket.onmessage = (event) => { const { event: type, data } = JSON.parse(event.data); if (type === 'error') return message(data.message === 'ROOM_FULL' ? 'That room already has two players.' : data.message === 'ROOM_NOT_FOUND' ? 'Room not found.' : data.message); if (type === 'room:created' || type === 'room:joined') { store(data.roomCode, data.playerToken); if (type === 'room:created') { $('lobby-actions').hidden = true; $('waiting-panel').hidden = false; } } if (type === 'room:waiting') { roomCode = data.roomCode; invite = data.inviteUrl; $('lobby-actions').hidden = true; $('waiting-panel').hidden = false; } if (type === 'game:state') { game = data.game; roomCode = data.roomCode; opponentOnline = data.connected.some((player) => player.id !== game.player.id && player.connected); render(); } };
socket.onclose = () => message('Connection lost. Refresh to reconnect.');
const requested = new URLSearchParams(location.search).get('room'); if (requested) { roomCode = requested.toUpperCase(); $('room-code').value = roomCode; $('lobby-actions').hidden = true; $('join-panel').hidden = false; socket.addEventListener('open', () => join(roomCode), { once: true }); }
