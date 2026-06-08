package db

import (
	"context"
	"fmt"
	"log"
	"time"

	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

var Client *mongo.Client
var DB *mongo.Database

// Connect initializes the MongoDB connection
func Connect(uri, dbName string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	clientOptions := options.Client().ApplyURI(uri)
	client, err := mongo.Connect(clientOptions)
	if err != nil {
		return fmt.Errorf("failed to connect to MongoDB: %w", err)
	}

	err = client.Ping(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to ping MongoDB: %w", err)
	}

	Client = client
	DB = client.Database(dbName)
	log.Println("Successfully connected to MongoDB!")

	return nil
}

// Disconnect closes the MongoDB connection
func Disconnect(ctx context.Context) error {
	if Client == nil {
		return nil
	}
	return Client.Disconnect(ctx)
}
