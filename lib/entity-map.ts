// lib/entity-map.ts
export interface EntityConfig {
  sapEntity: string
  keyType?: "number" | "string"
  defaultFilter?: string
  allowedActions?: string[]
  selectDefault?: string
}

const DOC_ACTIONS = ["Cancel", "Close", "Reopen"]

export const ENTITY_MAP: Record<string, EntityConfig> = {
  "compras/ordenes": { sapEntity: "PurchaseOrders", keyType: "number", allowedActions: DOC_ACTIONS, selectDefault: "DocEntry,DocNum,CardCode,CardName,DocDate,DocDueDate,DocTotal,DocumentStatus,Comments" },
  "compras/facturas": { sapEntity: "PurchaseInvoices", keyType: "number", allowedActions: ["Cancel"], selectDefault: "DocEntry,DocNum,CardCode,CardName,DocDate,DocDueDate,DocTotal,DocumentStatus" },
  "compras/notas-credito": { sapEntity: "PurchaseCreditNotes", keyType: "number", allowedActions: ["Cancel"], selectDefault: "DocEntry,DocNum,CardCode,CardName,DocDate,DocTotal,DocumentStatus" },
  "compras/entregas": { sapEntity: "PurchaseDeliveryNotes", keyType: "number", allowedActions: ["Cancel", "Close"], selectDefault: "DocEntry,DocNum,CardCode,CardName,DocDate,DocTotal,DocumentStatus" },
  "compras/devoluciones": { sapEntity: "PurchaseReturns", keyType: "number", selectDefault: "DocEntry,DocNum,CardCode,CardName,DocDate,DocTotal,DocumentStatus" },
  "compras/cotizaciones": { sapEntity: "PurchaseQuotations", keyType: "number", allowedActions: ["Cancel", "Close"], selectDefault: "DocEntry,DocNum,CardCode,CardName,DocDate,DocDueDate,DocTotal,DocumentStatus" },
  "compras/solicitudes": { sapEntity: "PurchaseRequests", keyType: "number", allowedActions: ["Cancel", "Close"], selectDefault: "DocEntry,DocNum,CardCode,CardName,DocDate,DocDueDate,DocumentStatus" },
  "ventas/pedidos": { sapEntity: "Orders", keyType: "number", allowedActions: DOC_ACTIONS, selectDefault: "DocEntry,DocNum,CardCode,CardName,DocDate,DocDueDate,DocTotal,DocumentStatus,Comments" },
  "ventas/facturas": { sapEntity: "Invoices", keyType: "number", allowedActions: ["Cancel"], selectDefault: "DocEntry,DocNum,CardCode,CardName,DocDate,DocDueDate,DocTotal,DocumentStatus" },
  "ventas/notas-credito": { sapEntity: "CreditNotes", keyType: "number", allowedActions: ["Cancel"], selectDefault: "DocEntry,DocNum,CardCode,CardName,DocDate,DocTotal,DocumentStatus" },
  "ventas/entregas": { sapEntity: "DeliveryNotes", keyType: "number", allowedActions: ["Cancel", "Close"], selectDefault: "DocEntry,DocNum,CardCode,CardName,DocDate,DocTotal,DocumentStatus" },
  "ventas/devoluciones": { sapEntity: "Returns", keyType: "number", selectDefault: "DocEntry,DocNum,CardCode,CardName,DocDate,DocTotal,DocumentStatus" },
  "ventas/cotizaciones": { sapEntity: "Quotations", keyType: "number", allowedActions: DOC_ACTIONS, selectDefault: "DocEntry,DocNum,CardCode,CardName,DocDate,DocDueDate,DocTotal,DocumentStatus" },
  "ventas/anticipos": { sapEntity: "DownPayments", keyType: "number", allowedActions: ["Cancel"], selectDefault: "DocEntry,DocNum,CardCode,CardName,DocDate,DocTotal,DocumentStatus" },
  "inventario/items": { sapEntity: "Items", keyType: "string", selectDefault: "ItemCode,ItemName,QuantityOnStock,AvgStdPrice,ItemsGroupCode,frozenFor" },
  "inventario/transferencias": { sapEntity: "StockTransfers", keyType: "number", allowedActions: ["Cancel"], selectDefault: "DocEntry,DocNum,FromWarehouse,ToWarehouse,DocDate,DocumentStatus" },
  "inventario/entradas": { sapEntity: "InventoryGenEntries", keyType: "number", allowedActions: ["Cancel"], selectDefault: "DocEntry,DocNum,DocDate,DocTotal,DocumentStatus,Comments" },
  "inventario/salidas": { sapEntity: "InventoryGenExits", keyType: "number", allowedActions: ["Cancel"], selectDefault: "DocEntry,DocNum,DocDate,DocTotal,DocumentStatus,Comments" },
  "inventario/almacenes": { sapEntity: "Warehouses", keyType: "string", selectDefault: "WarehouseCode,WarehouseName,Location" },
  "socios/clientes": { sapEntity: "BusinessPartners", keyType: "string", defaultFilter: "CardType eq 'cCustomer'", selectDefault: "CardCode,CardName,Phone1,EmailAddress,CurrentAccountBalance,CreditLimit" },
  "socios/proveedores": { sapEntity: "BusinessPartners", keyType: "string", defaultFilter: "CardType eq 'cSupplier'", selectDefault: "CardCode,CardName,Phone1,EmailAddress,CurrentAccountBalance" },
  "socios/todos": { sapEntity: "BusinessPartners", keyType: "string", selectDefault: "CardCode,CardName,CardType,Phone1,EmailAddress,CurrentAccountBalance" },
  "pagos/cobros": { sapEntity: "IncomingPayments", keyType: "number", allowedActions: ["Cancel"], selectDefault: "DocEntry,DocNum,CardCode,CardName,DocDate,DocTotal,CashSum,TrsfrSum,CheckSum" },
  "pagos/pagos": { sapEntity: "VendorPayments", keyType: "number", allowedActions: ["Cancel"], selectDefault: "DocEntry,DocNum,CardCode,CardName,DocDate,DocTotal" },
  "contabilidad/asientos": { sapEntity: "JournalEntries", keyType: "number", selectDefault: "JdtNum,RefDate,Memo,Debit,Credit" },
  "contabilidad/cuentas": { sapEntity: "ChartOfAccounts", keyType: "string", selectDefault: "Code,Name,AccountType,ActiveAccount" },
  "produccion/ordenes": { sapEntity: "ProductionOrders", keyType: "number", allowedActions: ["Cancel", "Close"], selectDefault: "DocEntry,ItemCode,PlannedQty,CmpltQty,DueDate,Status" },
  "produccion/bom": { sapEntity: "ProductionOrders", keyType: "number", selectDefault: "DocEntry,ItemCode,PlannedQty,Status" },
  "rrhh/empleados": { sapEntity: "EmployeesInfo", keyType: "number", selectDefault: "EmployeeID,FirstName,LastName,Department,Position,Active" },
}
