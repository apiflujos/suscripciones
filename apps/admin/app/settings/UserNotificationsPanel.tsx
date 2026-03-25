"use client";

import {
  getFilterIcon,
  getNotificationColor,
  getNotificationIcon,
  resolveNotificationHref,
  useNotificationsFeed
} from "../ui/notificationsFeed";

export function UserNotificationsPanel({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const {
    filteredNotifications,
    filter,
    setFilter,
    filterOptions,
    unreadCount,
    markNotification,
    markAll,
    clearAll
  } = useNotificationsFeed({ isSuperAdmin });

  return (
    <section className="settings-group">
      <div className="settings-group-header">
        <div className="panelHeaderRow" style={{ justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "grid", gap: 4 }}>
            <h3>Notificaciones del sistema</h3>
          </div>
          {unreadCount > 0 ? <span className="pill pill-blue">{unreadCount} no leidas</span> : null}
        </div>
      </div>

      <div className="settings-group-body">
        <div className="topbarBellFilters topbarBellFiltersText" style={{ marginBottom: 12 }}>
          {filterOptions.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`topbarBellFilter ${filter === opt.key ? "is-active" : ""}`}
              onClick={() => setFilter(opt.key)}
            >
              <span className="filter-icon">{getFilterIcon(opt.icon)}</span>
              <span className="filter-label">{opt.label}</span>
            </button>
          ))}
        </div>

        <div className="topbarBellActions" style={{ justifyContent: "flex-start", marginBottom: 12 }}>
          <button
            type="button"
            className="topbarBellActionBtn topbarBellActionBtnSmall"
            onClick={() => markAll(true)}
            disabled={unreadCount === 0}
          >
            Marcar todo leido
          </button>
          <button
            type="button"
            className="topbarBellActionBtn topbarBellActionBtnSmall"
            onClick={clearAll}
            disabled={filteredNotifications.length === 0}
          >
            Limpiar todo
          </button>
        </div>

        <div className="topbarBellList">
          {filteredNotifications.length > 0 ? (
            filteredNotifications.map((n) => {
              const icon = getNotificationIcon({ level: n.level, category: n.category });
              const colorClass = getNotificationColor(n.level);
              const destinationHref = n.href || resolveNotificationHref(n.category, n.level, isSuperAdmin ? "SUPER_ADMIN" : "USER");
              return (
                <div key={n.id} className={`topbarBellItem ${colorClass} ${n.read ? "is-read" : "is-unread"}`}>
                  <a
                    href={destinationHref}
                    className="topbarBellItemLinkWrap"
                    onClick={() => markNotification(n.id, true)}
                  >
                    <div className="topbarBellItemIcon">{icon}</div>
                    <div className="topbarBellItemContent">
                      <div className="topbarBellItemTitle">
                        {n.title || "Notificacion"}
                        {n.duplicateCount && n.duplicateCount > 1 ? (
                          <span className="topbarBellItemDuplicate">×{n.duplicateCount}</span>
                        ) : null}
                      </div>
                      <div className="topbarBellItemMsg">{n.message || "Sin detalle"}</div>
                      <div className="topbarBellItemMeta">
                        <span className="category-badge">{n.category}</span>
                        <span className="time-ago">
                          {new Date(n.ts).toLocaleString("es-CO", {
                            hour: "2-digit",
                            minute: "2-digit",
                            day: "2-digit",
                            month: "2-digit"
                          })}
                        </span>
                      </div>
                    </div>
                    {!n.read && <span className="topbarBellItemDot" />}
                  </a>
                </div>
              );
            })
          ) : (
            <div className="topbarBellEmpty">
              <div className="empty-icon">{getFilterIcon("bell")}</div>
              <div className="empty-text">
                {filter === "unread"
                  ? "No tienes notificaciones no leidas"
                  : filter === "read"
                  ? "No tienes notificaciones leidas"
                  : typeof filter === "string" && filter !== "all"
                  ? `No hay notificaciones de ${filter}`
                  : "Sin notificaciones"}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
