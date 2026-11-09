import assert from "node:assert/strict";
import test from "node:test";
import { isNavItemActive } from "../src/lib/navigation/is-nav-item-active";

const admin = ["/dashboard", "/dashboard/analytics", "/dashboard/orders", "/dispatch", "/dispatch/map", "/dashboard/clients"];

test("menu : la fiche d'une livraison allume Dispatch, pas le tableau de bord (AUDIT-0411)", () => {
  assert.equal(isNavItemActive("/dashboard/deliveries/abc", "/dispatch", admin), true);
  assert.equal(isNavItemActive("/dashboard/deliveries/abc", "/dashboard", admin), false);
});

test("menu : l'ancienne carte des livreurs allume Carte, pas Dispatch", () => {
  assert.equal(isNavItemActive("/dispatch/drivers", "/dispatch/map", admin), true);
  assert.equal(isNavItemActive("/dispatch/drivers", "/dispatch", admin), false);
});

test("menu : sans entrée cible, rien n'est détourné ; les cas ordinaires ne changent pas", () => {
  const noMap = ["/dashboard", "/dispatch", "/dispatch/drivers"];
  assert.equal(isNavItemActive("/dispatch/drivers", "/dispatch/drivers", noMap), true);
  assert.equal(isNavItemActive("/dispatch/drivers", "/dispatch", noMap), false);
  assert.equal(isNavItemActive("/dashboard/orders/1", "/dashboard/orders", admin), true);
  assert.equal(isNavItemActive("/dashboard/orders/1", "/dashboard", admin), false);
  assert.equal(isNavItemActive("/dashboard", "/dashboard", admin), true);
});
