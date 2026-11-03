import { Navigate, Route, Routes } from "react-router-dom";
import { Loading } from "./components/ui";
import { useApp } from "./state/app";
import { Login } from "./pages/auth/Login";
import { Onboarding } from "./pages/auth/Onboarding";
import { Shell } from "./pages/emc/Shell";
import { Dashboard, MenuEngineering, Reports } from "./pages/emc/Reports";
import {
  AccountsPage,
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
import { JournalsPage, MappingPage, StatementsPage } from "./pages/emc/Accounting";
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
        <Route path="accounting/journals" element={<JournalsPage />} />
        <Route path="accounting/statements" element={<StatementsPage />} />
        <Route path="accounting/accounts" element={<AccountsPage />} />
        <Route path="accounting/mapping" element={<MappingPage />} />
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
