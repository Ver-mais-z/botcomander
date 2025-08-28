import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const table = await (queryInterface as any).describeTable("Queues");

    // schedules
    if (!table.schedules) {
      await queryInterface.addColumn("Queues", "schedules", {
        // Use JSON no MySQL/MariaDB; se sua versão não suportar, troque por DataTypes.TEXT
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: []
      });
    } else {
      // Garante o tipo correto (troca JSONB -> JSON, se necessário)
      await queryInterface.changeColumn("Queues", "schedules", {
        type: DataTypes.JSON,
        allowNull: true
      });
    }

    // outOfHoursMessage
    if (!table.outOfHoursMessage) {
      await queryInterface.addColumn("Queues", "outOfHoursMessage", {
        type: DataTypes.TEXT,
        allowNull: true
      });
    }
  },

  down: async (queryInterface: QueryInterface) => {
    const table = await (queryInterface as any).describeTable("Queues");

    if (table.schedules) {
      await queryInterface.removeColumn("Queues", "schedules");
    }
    if (table.outOfHoursMessage) {
      await queryInterface.removeColumn("Queues", "outOfHoursMessage");
    }
  }
};
