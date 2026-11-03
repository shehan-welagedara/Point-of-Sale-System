import { Navigate, Route, Routes } from "react-router-dom";
import { Loading } from "./components/ui";
import { useApp } from "./state/app";
import { Login } from "./pages/auth/Login";
import { Onboarding } from "./pages/auth/Onboarding";
import { Shell } from "./pages/emc/Shell";
import { Dashboard, MenuEngineering, Reports } from "./pages/emc/Reports";
import {
  CategoriesPage,
  CustomersPage,
  DevicesPage,
  DiscountsPage,
  MenuItemsPage,
  ModifiersPage,
  OrderTypesPage,
  OrganisationPage,
  ReasonsPage,
  StaffPage,
  StockItemsPage,
  TablesPage,
  TendersPage,
  VendorsPage,
} from "./pages/emc/config";
import { RecipesPage } from "./pages/emc/Recipes";
import { AdjustPage, GoodsReceiptsPage, MovementsPage, PurchaseOrdersPage, StockCountsPage, StockOnHand } from "./pages/emc/Inventory";
import { FinanceOverview } from "./pages/finance/Overview";
import { ApprovalsPage, DocumentsPage, JournalsPage } from "./pages/finance/Journals";
import { PayablesPage, ReceivablesPage } from "./pages/finance/Parties";
import { BankPage } from "./pages/finance/Bank";
import { AssetsPage } from "./pages/finance/Assets";
import { StatementsPage } from "./pages/finance/Statements";
import { PeriodsPage } from "./pages/finance/Periods";
import { BudgetsPage, ChartOfAccountsPage, FinanceSettingsPage } from "./pages/finance/Masters";
import { AuditCenter } from "./pages/audit/AuditCenter";
import { BrandingPage, BusinessTaxPage, IntegrationsPage, ModulesPage } from "./pages/emc/Setup";
import { DataPage, LoginsPage, PrintQueuePage, RolesPage } from "./pages/emc/Admin";
import { PosApp } from "./pages/pos/Pos";

export function App() {
  const { ready, mode, user, tenant } = useApp();
  if (!ready) return <Loading />;
  if (mode === "firebase" && !user) return <Login />;
  if (!tenant) return <Onboarding />;
  return (
    <Routes>
      <Route path="/pos" element={<PosApp />} />
      <Route path="/emc" element={<Shell />}>
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="reports" element={<Reports />} />
        <Route path="revenue/engineering" element={<MenuEngineering />} />
        <Route path="pos/print-queue" element={<PrintQueuePage />} />
        <Route path="pos/tables" element={<TablesPage />} />
        <Route path="pos/order-types" element={<OrderTypesPage />} />
        <Route path="pos/tenders" element={<TendersPage />} />
        <Route path="pos/discounts" element={<DiscountsPage />} />
        <Route path="pos/reasons" element={<ReasonsPage />} />
        <Route path="menu/items" element={<MenuItemsPage />} />
        <Route path="menu/categories" element={<CategoriesPage />} />
        <Route path="menu/modifiers" element={<ModifiersPage />} />
        <Route path="recipes" element={<RecipesPage />} />
        <Route path="inventory/stock" element={<StockOnHand />} />
        <Route path="inventory/items" element={<StockItemsPage />} />
        <Route path="inventory/po" element={<PurchaseOrdersPage />} />
        <Route path="inventory/grn" element={<GoodsReceiptsPage />} />
        <Route path="inventory/vendors" element={<VendorsPage />} />
        <Route path="inventory/counts" element={<StockCountsPage />} />
        <Route path="inventory/adjust" element={<AdjustPage />} />
        <Route path="inventory/movements" element={<MovementsPage />} />
        <Route path="crm/customers" element={<CustomersPage />} />
        <Route path="finance" element={<FinanceOverview />} />
        <Route path="finance/approvals" element={<ApprovalsPage />} />
        <Route path="finance/journals" element={<JournalsPage />} />
        <Route path="finance/payables" element={<PayablesPage />} />
        <Route path="finance/receivables" element={<ReceivablesPage />} />
        <Route path="finance/bank" element={<BankPage />} />
        <Route path="finance/assets" element={<AssetsPage />} />
        <Route path="finance/budgets" element={<BudgetsPage />} />
        <Route path="finance/statements" element={<StatementsPage />} />
        <Route path="finance/documents" element={<DocumentsPage />} />
        <Route path="finance/periods" element={<PeriodsPage />} />
        <Route path="finance/accounts" element={<ChartOfAccountsPage />} />
        <Route path="finance/settings" element={<FinanceSettingsPage />} />
        <Route path="accounting/*" element={<Navigate to="/emc/finance" replace />} />
        <Route path="audit" element={<AuditCenter />} />
        <Route path="people/staff" element={<StaffPage />} />
        <Route path="people/roles" element={<RolesPage />} />
        <Route path="people/logins" element={<LoginsPage />} />
        <Route path="setup/business" element={<BusinessTaxPage />} />
        <Route path="setup/branding" element={<BrandingPage />} />
        <Route path="setup/organisation" element={<OrganisationPage />} />
        <Route path="setup/devices" element={<DevicesPage />} />
        <Route path="setup/modules" element={<ModulesPage />} />
        <Route path="setup/integrations" element={<IntegrationsPage />} />
        <Route path="setup/data" element={<DataPage />} />
        <Route index element={<Navigate to="dashboard" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/emc/dashboard" replace />} />
    </Routes>
  );
}
