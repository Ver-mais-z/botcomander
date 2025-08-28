// src/database/migrations/20211227010200-create-schedules.ts
import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    // Cria a tabela sem FKs
    await queryInterface.createTable(
      "Schedules",
      {
        id: {
          type: DataTypes.INTEGER,
          autoIncrement: true,
          primaryKey: true,
          allowNull: false
        },
        body: {
          type: DataTypes.TEXT,
          allowNull: false
        },
        sendAt: {
          type: DataTypes.DATE,
          allowNull: true
        },
        sentAt: {
          type: DataTypes.DATE,
          allowNull: true
        },
        contactId: {
          type: DataTypes.INTEGER,
          allowNull: true
        },
        ticketId: {
          type: DataTypes.INTEGER,
          allowNull: true
        },
        userId: {
          type: DataTypes.INTEGER,
          allowNull: true
        },
        createdAt: {
          type: DataTypes.DATE,
          allowNull: false
        },
        updatedAt: {
          type: DataTypes.DATE,
          allowNull: false
        }
      },
      {
        charset: "utf8mb4",
        collate: "utf8mb4_bin"
      }
    );

    // FK: contactId -> Contacts(id)
    await queryInterface.addConstraint(
      "Schedules",
      ["contactId"],
      {
        type: "foreign key",
        name: "fk_schedules_contactId",
        references: { table: "Contacts", field: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      }
    );

    // FK: ticketId -> Tickets(id)
    await queryInterface.addConstraint(
      "Schedules",
      ["ticketId"],
      {
        type: "foreign key",
        name: "fk_schedules_ticketId",
        references: { table: "Tickets", field: "id" },
        onUpdate: "SET NULL",
        onDelete: "SET NULL"
      }
    );

    // FK: userId -> Users(id)
    await queryInterface.addConstraint(
      "Schedules",
      ["userId"],
      {
        type: "foreign key",
        name: "fk_schedules_userId",
        references: { table: "Users", field: "id" },
        onUpdate: "SET NULL",
        onDelete: "SET NULL"
      }
    );
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("Schedules");
  }
};
