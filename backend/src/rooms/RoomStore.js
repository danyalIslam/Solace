/**
 * RoomStore — persistence seam for rooms.
 *
 * This module is an interface definition only. It contains no implementation
 * logic. Concrete stores (e.g. MemoryRoomStore) MUST satisfy this contract so
 * the in-memory default can be swapped for a DB-backed store without touching
 * services or handlers.
 *
 * @interface RoomStore
 */

/**
 * Create and persist a room.
 *
 * @param {string} [roomId] - Optional forced room id. When omitted the store
 *   generates a unique id (e.g. 6-char code) and ensures uniqueness by
 *   retrying.
 * @returns {import('./Room')} the persisted Room instance.
 */
function create(roomId) {}

/**
 * Fetch a room by id.
 *
 * @param {string} roomId
 * @returns {import('./Room')|null} the Room or null when not found.
 */
function get(roomId) {}

/**
 * Remove a room by id. No-op when the room does not exist.
 *
 * @param {string} roomId
 */
function remove(roomId) {}

module.exports = {};