package crypto

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"io"

	"golang.org/x/crypto/argon2"
)

const (
	argonTime    = 3
	argonMemory  = 64 * 1024
	argonThreads = 4
	argonKeyLen  = 32
	saltLen      = 16
)

// DeriveExamKey derives a 32-byte AES key from exam ID + master secret using Argon2id.
// The salt is randomly generated and prepended to the derived key material for storage/transmission.
func DeriveExamKey(examID string, masterSecret []byte) (derivedKey []byte, saltHex string, err error) {
	salt := make([]byte, saltLen)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		return nil, "", err
	}

	password := append([]byte(examID), masterSecret...)
	key := argon2.IDKey(password, salt, argonTime, argonMemory, argonThreads, argonKeyLen)

	return key, hex.EncodeToString(salt), nil
}

// DeriveExamKeyWithSalt re-derives the 32-byte key given the examID, masterSecret, and the salt string.
func DeriveExamKeyWithSalt(examID string, masterSecret []byte, saltHex string) ([]byte, error) {
	salt, err := hex.DecodeString(saltHex)
	if err != nil {
		return nil, err
	}

	password := append([]byte(examID), masterSecret...)
	key := argon2.IDKey(password, salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return key, nil
}

// HMACKey derives a 32-byte signing key for HMAC auth, separate from the encryption key.
func HMACKey(examID string, masterSecret []byte) []byte {
	h := hmac.New(sha256.New, masterSecret)
	h.Write([]byte("hmac-signing-"))
	h.Write([]byte(examID))
	return h.Sum(nil)
}

// NonceSecret derives a 32-byte nonce secret for anti-replay tokens.
func NonceSecret(examID string, masterSecret []byte) []byte {
	h := hmac.New(sha256.New, masterSecret)
	h.Write([]byte("nonce-secret-"))
	h.Write([]byte(examID))
	return h.Sum(nil)
}
