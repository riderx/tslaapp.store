CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  friend_code TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE friendships (
  requester_id TEXT NOT NULL,
  addressee_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (requester_id, addressee_id)
);

CREATE INDEX friendships_addressee ON friendships(addressee_id, status);
CREATE INDEX friendships_code_lookup ON users(friend_code);

CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE group_members (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX group_members_user ON group_members(user_id);
