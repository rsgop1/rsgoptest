import { Switch, Route, Redirect } from "wouter";
import { Layout } from "./components/layout";
import Login from "./pages/login";
import Dashboard from "./pages/dashboard";
import Payments from "./pages/payments";
import Tests from "./pages/tests";
import Analytics from "./pages/analytics";
import FlashSales from "./pages/flash-sales";
import Settings from "./pages/settings";
import Users from "./pages/users";
import Ads from "./pages/ads";
import Telemetry from "./pages/telemetry";
import Reports from "./pages/reports";
import LiveTests from "./pages/live-tests";
import Ai from "./pages/ai";

function AppRoutes() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/">
        <Redirect to="/dashboard" />
      </Route>
      <Route path="/dashboard">
        <Layout><Dashboard /></Layout>
      </Route>
      <Route path="/payments">
        <Layout><Payments /></Layout>
      </Route>
      <Route path="/tests">
        <Layout><Tests /></Layout>
      </Route>
      <Route path="/analytics">
        <Layout><Analytics /></Layout>
      </Route>
      <Route path="/flash-sales">
        <Layout><FlashSales /></Layout>
      </Route>
      <Route path="/ads">
        <Layout><Ads /></Layout>
      </Route>
      <Route path="/reports">
        <Layout><Reports /></Layout>
      </Route>
      <Route path="/live-tests">
        <Layout><LiveTests /></Layout>
      </Route>
      <Route path="/users">
        <Layout><Users /></Layout>
      </Route>
      <Route path="/settings">
        <Layout><Settings /></Layout>
      </Route>
      <Route path="/telemetry">
        <Layout><Telemetry /></Layout>
      </Route>
      <Route path="/ai">
        <Layout><Ai /></Layout>
      </Route>
      <Route>
        <Layout><div className="flex items-center justify-center h-[50vh] text-2xl font-bold text-muted-foreground">Page Not Found</div></Layout>
      </Route>
    </Switch>
  );
}

export default AppRoutes;
