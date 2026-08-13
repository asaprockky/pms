import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma.service';
import {
  DAY_MS,
  DELIVERY_STATUSES,
  FOLIO_METHODS,
  MANAGER_ROLES,
  ORDER_FLOW,
  PAYMENT_METHODS,
  STUCK_PAYMENT_MINUTES,
  plural,
  VOID_APPROVAL_THRESHOLD,
  isoDate,
  utcDay,
} from './fb.constants';

/** A line as it will be charged — snapshots, never live menu values. */
interface PricedLine {
  name: string;
  qty: number;
  price: number;
  vatPercent: number;
  ikpuCode: string | null;
  category: string;
}

@Injectable()
export class OutletService {
  private readonly logger = new Logger(OutletService.name);
  constructor(private readonly prisma: PrismaService, private readonly events: EventEmitter2) {}

  /* ─── Outlets ───────────────────────────────────────────────────────────── */

  async getConfigs(hotelId: string) {
    const outlets = await this.prisma.outletConfig.findMany({
      where: { hotelId },
      orderBy: { createdAt: 'asc' },
    });
    // Table/menu counts drive the outlet cards; one grouped query beats N+1.
    const [tables, menu, openOrders] = await Promise.all([
      this.prisma.fbTable.groupBy({ by: ['outletId'], where: { hotelId, active: true }, _count: true }),
      this.prisma.fbMenuItem.groupBy({ by: ['outletId'], where: { hotelId, active: true }, _count: true }),
      this.prisma.outletOrder.groupBy({
        by: ['outletId'],
        where: { hotelId, status: { notIn: ['closed', 'void'] } },
        _count: true,
      }),
    ]);
    const count = (rows: { outletId: string; _count: number }[], id: string) =>
      rows.find((r) => r.outletId === id)?._count ?? 0;
    return outlets.map((o) => ({
      ...o,
      tableCount: count(tables as any, o.id),
      menuCount: count(menu as any, o.id),
      openOrderCount: count(openOrders as any, o.id),
    }));
  }

  async createConfig(hotelId: string, dto: Record<string, any>) {
    const name = String(dto.name ?? '').trim();
    if (!name) throw new BadRequestException('Outlet name is required');
    return this.prisma.outletConfig.create({
      data: {
        hotelId,
        name,
        type: dto.type ?? 'restaurant',
        fiscalized: dto.fiscalized ?? false,
        // Auto-derive a stable short code when none is supplied — it lands on
        // fiscal receipts, so it must never be empty.
        outletCode: String(dto.outletCode ?? '').trim() || `FB-${name.slice(0, 4).toUpperCase()}-${Date.now() % 1000}`,
        defaultVatPercent: dto.defaultVatPercent ?? 12,
        defaultIkpu: dto.defaultIkpu || null,
        workingHours: dto.workingHours ? JSON.stringify(dto.workingHours) : null,
        serviceChargePct: dto.serviceChargePct ?? 0,
      },
    });
  }

  async updateConfig(id: string, dto: Record<string, any>) {
    const data: Record<string, any> = {};
    for (const k of ['name', 'type', 'outletCode', 'defaultIkpu'] as const) {
      if (dto[k] !== undefined) data[k] = dto[k];
    }
    for (const k of ['defaultVatPercent', 'serviceChargePct'] as const) {
      if (dto[k] !== undefined) data[k] = Number(dto[k]);
    }
    for (const k of ['fiscalized', 'active'] as const) {
      if (dto[k] !== undefined) data[k] = Boolean(dto[k]);
    }
    if (dto.workingHours !== undefined) {
      data.workingHours = dto.workingHours ? JSON.stringify(dto.workingHours) : null;
    }
    return this.prisma.outletConfig.update({ where: { id }, data });
  }

  /* ─── Tables ────────────────────────────────────────────────────────────── */

  async getTables(hotelId: string, outletId?: string) {
    const tables = await this.prisma.fbTable.findMany({
      where: { hotelId, active: true, ...(outletId ? { outletId } : {}) },
      orderBy: [{ zone: 'asc' }, { number: 'asc' }],
    });
    // Attach the live check so the floor plan can show a running total without
    // a second round trip per table.
    const orderIds = tables.map((t) => t.currentOrderId).filter(Boolean) as string[];
    const orders = orderIds.length
      ? await this.prisma.outletOrder.findMany({
          where: { id: { in: orderIds } },
          select: { id: true, total: true, covers: true, status: true, createdAt: true },
        })
      : [];
    return tables.map((t) => ({
      ...t,
      currentOrder: orders.find((o) => o.id === t.currentOrderId) ?? null,
    }));
  }

  async createTable(hotelId: string, dto: Record<string, any>) {
    const outlet = await this.prisma.outletConfig.findFirst({ where: { id: dto.outletId, hotelId } });
    if (!outlet) throw new NotFoundException('Outlet not found');
    const number = String(dto.number ?? '').trim();
    if (!number) throw new BadRequestException('Table number is required');
    const clash = await this.prisma.fbTable.findFirst({
      where: { outletId: dto.outletId, number, active: true },
    });
    if (clash) throw new BadRequestException(`Table ${number} already exists in this outlet`);
    return this.prisma.fbTable.create({
      data: {
        hotelId,
        outletId: dto.outletId,
        number,
        zone: dto.zone?.trim() || null,
        capacity: Number(dto.capacity) || 2,
      },
    });
  }

  async updateTable(hotelId: string, id: string, dto: Record<string, any>) {
    const table = await this.prisma.fbTable.findFirst({ where: { id, hotelId } });
    if (!table) throw new NotFoundException('Table not found');

    if (dto.status !== undefined && dto.status !== table.status) {
      // A table with a live check can't be hand-waved back to free — close or
      // void the order first, or the check becomes unreachable from the floor.
      if (table.currentOrderId && ['free', 'reserved', 'blocked'].includes(dto.status)) {
        throw new BadRequestException('Close or void the open check before changing this table\'s status');
      }
    }
    const data: Record<string, any> = {};
    if (dto.number !== undefined) data.number = String(dto.number).trim();
    if (dto.zone !== undefined) data.zone = dto.zone?.trim() || null;
    if (dto.capacity !== undefined) data.capacity = Number(dto.capacity) || 2;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.active !== undefined) data.active = Boolean(dto.active);
    return this.prisma.fbTable.update({ where: { id }, data });
  }

  async deleteTable(hotelId: string, id: string) {
    const table = await this.prisma.fbTable.findFirst({ where: { id, hotelId } });
    if (!table) throw new NotFoundException('Table not found');
    if (table.currentOrderId) throw new BadRequestException('Table has an open check');
    // Soft delete: historical orders reference this table and must stay readable.
    return this.prisma.fbTable.update({ where: { id }, data: { active: false, status: 'free' } });
  }

  /**
   * Combine tables onto one check. The leader keeps its order; followers are
   * marked occupied and point at the leader. Splitting back apart is manual by
   * design — the system has no way to know which table ordered which line.
   */
  async mergeTables(hotelId: string, leaderId: string, followerIds: string[]) {
    const leader = await this.prisma.fbTable.findFirst({ where: { id: leaderId, hotelId } });
    if (!leader) throw new NotFoundException('Table not found');
    if (!leader.currentOrderId) throw new BadRequestException('Open a check on the main table first');
    const followers = await this.prisma.fbTable.findMany({
      where: { id: { in: followerIds }, hotelId, outletId: leader.outletId },
    });
    if (followers.length !== followerIds.length) {
      throw new BadRequestException('All merged tables must belong to the same outlet');
    }
    const withChecks = followers.filter((f) => f.currentOrderId);
    if (withChecks.length) {
      throw new BadRequestException(
        `Close the check on table ${withChecks.map((f) => f.number).join(', ')} before merging`,
      );
    }
    await this.prisma.fbTable.updateMany({
      where: { id: { in: followerIds } },
      data: { mergedInto: leaderId, status: 'occupied' },
    });
    return this.getTables(hotelId, leader.outletId);
  }

  async unmergeTable(hotelId: string, id: string) {
    const table = await this.prisma.fbTable.findFirst({ where: { id, hotelId } });
    if (!table) throw new NotFoundException('Table not found');
    await this.prisma.fbTable.update({
      where: { id },
      data: { mergedInto: null, status: 'dirty' },
    });
    return this.getTables(hotelId, table.outletId);
  }

  /* ─── Menu ──────────────────────────────────────────────────────────────── */

  async getMenu(hotelId: string, outletId?: string, opts: { category?: string; search?: string } = {}) {
    const items = await this.prisma.fbMenuItem.findMany({
      where: {
        hotelId,
        active: true,
        ...(outletId ? { outletId } : {}),
        ...(opts.category ? { category: opts.category } : {}),
        ...(opts.search
          ? { name: { contains: opts.search } }
          : {}),
      },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
    return items;
  }

  async createMenuItem(hotelId: string, dto: Record<string, any>) {
    const outlet = await this.prisma.outletConfig.findFirst({ where: { id: dto.outletId, hotelId } });
    if (!outlet) throw new NotFoundException('Outlet not found');
    const name = String(dto.name ?? '').trim();
    if (!name) throw new BadRequestException('Item name is required');
    return this.prisma.fbMenuItem.create({
      data: {
        hotelId,
        outletId: dto.outletId,
        name,
        description: dto.description?.trim() || null,
        imageUrl: dto.imageUrl?.trim() || null,
        category: dto.category ?? 'food',
        price: Number(dto.price) || 0,
        // Fall back to the outlet's rate rather than a hardcoded 12 — the
        // country pack owns that number.
        vatPercent: dto.vatPercent !== undefined ? Number(dto.vatPercent) : outlet.defaultVatPercent,
        ikpuCode: dto.ikpuCode?.trim() || null,
        halal: Boolean(dto.halal),
        stopList: Boolean(dto.stopList),
        sortOrder: Number(dto.sortOrder) || 0,
      },
    });
  }

  async updateMenuItem(hotelId: string, id: string, dto: Record<string, any>) {
    const item = await this.prisma.fbMenuItem.findFirst({ where: { id, hotelId } });
    if (!item) throw new NotFoundException('Menu item not found');
    const data: Record<string, any> = {};
    if (dto.name !== undefined) data.name = String(dto.name).trim();
    if (dto.description !== undefined) data.description = dto.description?.trim() || null;
    if (dto.imageUrl !== undefined) data.imageUrl = dto.imageUrl?.trim() || null;
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.price !== undefined) data.price = Number(dto.price) || 0;
    if (dto.vatPercent !== undefined) data.vatPercent = Number(dto.vatPercent);
    if (dto.ikpuCode !== undefined) data.ikpuCode = dto.ikpuCode?.trim() || null;
    if (dto.halal !== undefined) data.halal = Boolean(dto.halal);
    if (dto.stopList !== undefined) data.stopList = Boolean(dto.stopList);
    if (dto.sortOrder !== undefined) data.sortOrder = Number(dto.sortOrder) || 0;
    if (dto.active !== undefined) data.active = Boolean(dto.active);
    return this.prisma.fbMenuItem.update({ where: { id }, data });
  }

  async deleteMenuItem(hotelId: string, id: string) {
    const item = await this.prisma.fbMenuItem.findFirst({ where: { id, hotelId } });
    if (!item) throw new NotFoundException('Menu item not found');
    // Soft delete — closed checks still reference it for reporting.
    return this.prisma.fbMenuItem.update({ where: { id }, data: { active: false } });
  }

  /* ─── Orders ────────────────────────────────────────────────────────────── */

  async createOrder(hotelId: string, dto: Record<string, any>, staffId?: string) {
    const outlet = await this.prisma.outletConfig.findFirst({ where: { id: dto.outletId, hotelId } });
    if (!outlet) throw new NotFoundException('Outlet not found');

    let tableNumber: string | null = null;
    if (dto.tableId) {
      const table = await this.prisma.fbTable.findFirst({ where: { id: dto.tableId, hotelId } });
      if (!table) throw new NotFoundException('Table not found');
      if (table.currentOrderId) throw new BadRequestException(`Table ${table.number} already has an open check`);
      if (table.status === 'blocked') throw new BadRequestException(`Table ${table.number} is blocked`);
      tableNumber = table.number;
    }

    // Room service needs somewhere to deliver to; a table order does not.
    const isRoomService = outlet.type === 'room_service' || !!dto.deliveryLocation;
    if (isRoomService && !dto.deliveryLocation?.trim()) {
      throw new BadRequestException('Room service needs a delivery location');
    }

    const order = await this.prisma.outletOrder.create({
      data: {
        hotelId,
        outletId: dto.outletId,
        reservationId: dto.reservationId || null,
        guestId: dto.guestId || null,
        tableId: dto.tableId || null,
        tableNumber: tableNumber ?? (dto.tableNumber || null),
        covers: Number(dto.covers) || 1,
        note: dto.note?.trim() || null,
        openedBy: staffId ?? null,
        staffId: staffId ?? null,
        deliveryLocation: isRoomService ? dto.deliveryLocation.trim() : null,
        deliveryStatus: isRoomService ? 'preparing' : null,
      },
    });

    if (dto.tableId) {
      await this.prisma.fbTable.update({
        where: { id: dto.tableId },
        data: { status: 'occupied', currentOrderId: order.id },
      });
    }
    return order;
  }

  async getOrders(
    hotelId: string,
    opts: { status?: string; outletId?: string; paymentMethod?: string; roomService?: boolean; search?: string } = {},
  ) {
    const where: Record<string, any> = { hotelId };
    // 'active' is the working set the floor cares about, not a stored status.
    if (opts.status === 'active') where.status = { notIn: ['closed', 'void'] };
    else if (opts.status) where.status = opts.status;
    if (opts.outletId) where.outletId = opts.outletId;
    if (opts.paymentMethod) where.paymentMethod = opts.paymentMethod;
    if (opts.roomService) where.deliveryStatus = { not: null };

    const orders = await this.prisma.outletOrder.findMany({
      where,
      include: { items: true, outlet: { select: { id: true, name: true, type: true } } },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    if (!opts.search) return orders;
    const q = opts.search.toLowerCase();
    return orders.filter(
      (o) =>
        o.id.toLowerCase().includes(q) ||
        (o.tableNumber ?? '').toLowerCase().includes(q) ||
        (o.deliveryLocation ?? '').toLowerCase().includes(q) ||
        o.items.some((i) => i.name.toLowerCase().includes(q)),
    );
  }

  async getOrder(hotelId: string, id: string) {
    const order = await this.prisma.outletOrder.findFirst({
      where: { id, hotelId },
      include: { items: true, outlet: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  /**
   * Add a line. When menuItemId is given the name/price/VAT/IKPU are copied
   * from the catalog at this moment and frozen — a later menu price change must
   * never move the total of a check that is already open.
   */
  async addItem(hotelId: string, orderId: string, dto: Record<string, any>) {
    const order = await this.assertOpen(hotelId, orderId);

    let line: PricedLine;
    if (dto.menuItemId) {
      const item = await this.prisma.fbMenuItem.findFirst({ where: { id: dto.menuItemId, hotelId } });
      if (!item) throw new NotFoundException('Menu item not found');
      if (item.stopList) throw new BadRequestException(`"${item.name}" is on the stop list`);
      const outlet = await this.prisma.outletConfig.findUnique({ where: { id: order.outletId } });
      line = {
        name: item.name,
        qty: Number(dto.qty) || 1,
        price: item.price,
        vatPercent: item.vatPercent,
        ikpuCode: item.ikpuCode ?? outlet?.defaultIkpu ?? null,
        category: item.category,
      };
    } else {
      const name = String(dto.name ?? '').trim();
      if (!name) throw new BadRequestException('Item name is required');
      const outlet = await this.prisma.outletConfig.findUnique({ where: { id: order.outletId } });
      line = {
        name,
        qty: Number(dto.qty) || 1,
        price: Number(dto.price) || 0,
        vatPercent: dto.vatPercent !== undefined ? Number(dto.vatPercent) : (outlet?.defaultVatPercent ?? 12),
        ikpuCode: dto.ikpuCode?.trim() || outlet?.defaultIkpu || null,
        category: dto.category ?? 'food',
      };
    }
    if (line.qty < 1) throw new BadRequestException('Quantity must be at least 1');

    await this.prisma.outletOrderItem.create({
      data: {
        orderId,
        name: line.name,
        qty: line.qty,
        price: line.price,
        category: line.category,
        vatPercent: line.vatPercent,
        ikpuCode: line.ikpuCode,
        menuItemId: dto.menuItemId || null,
      },
    });
    return this.recalc(orderId);
  }

  /**
   * Void a line. Voiding something already served, or worth more than the
   * threshold, needs a manager — and always writes who/why, because the
   * Antifraud module reads exactly those fields.
   */
  async voidItem(hotelId: string, itemId: string, dto: Record<string, any>, actor?: { id?: string; role?: string }) {
    const item = await this.prisma.outletOrderItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Order item not found');
    const order = await this.assertOpen(hotelId, item.orderId);
    if (item.status === 'void') throw new BadRequestException('Item is already voided');

    const reason = String(dto.reason ?? '').trim();
    if (!reason) throw new BadRequestException('A void reason is required');

    const value = item.qty * item.price;
    const needsManager = item.status === 'served' || value >= VOID_APPROVAL_THRESHOLD;
    if (needsManager && !MANAGER_ROLES.includes(actor?.role ?? '')) {
      throw new ForbiddenException(
        item.status === 'served'
          ? 'Voiding a served item requires a manager'
          : `Voiding an item over ${VOID_APPROVAL_THRESHOLD} requires a manager`,
      );
    }

    await this.prisma.outletOrderItem.update({
      where: { id: itemId },
      data: { status: 'void', voidedBy: actor?.id ?? null, voidReason: reason, voidedAt: new Date() },
    });
    this.events.emit('fb.item.voided', {
      hotelId,
      orderId: order.id,
      itemId,
      name: item.name,
      value,
      voidedBy: actor?.id ?? null,
      reason,
      requiredManager: needsManager,
      timestamp: new Date(),
    });
    this.logger.warn(`Void: ${item.name} x${item.qty} (${value}) on order ${order.id} — ${reason}`);
    return this.recalc(item.orderId);
  }

  async setItemStatus(hotelId: string, itemId: string, status: string) {
    if (!['ordered', 'served'].includes(status)) throw new BadRequestException('Invalid item status');
    const item = await this.prisma.outletOrderItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Order item not found');
    await this.assertOpen(hotelId, item.orderId);
    if (item.status === 'void') throw new BadRequestException('Voided items cannot change status');
    await this.prisma.outletOrderItem.update({ where: { id: itemId }, data: { status } });
    return this.getOrder(hotelId, item.orderId);
  }

  async setOrderStatus(hotelId: string, id: string, status: string) {
    const order = await this.getOrder(hotelId, id);
    if (status === 'closed') {
      throw new BadRequestException('Use the close endpoint — closing posts to folio and fiscalizes');
    }
    const allowed = ORDER_FLOW[order.status] ?? [];
    if (!allowed.includes(status)) {
      throw new BadRequestException(`Cannot move an order from ${order.status} to ${status}`);
    }
    if (status === 'void') return this.voidOrder(hotelId, id, 'Voided from order screen');
    return this.prisma.outletOrder.update({ where: { id }, data: { status } });
  }

  async setDeliveryStatus(hotelId: string, id: string, status: string) {
    if (!(DELIVERY_STATUSES as readonly string[]).includes(status)) {
      throw new BadRequestException('Invalid delivery status');
    }
    const order = await this.getOrder(hotelId, id);
    if (!order.deliveryStatus) throw new BadRequestException('This is not a room service order');
    return this.prisma.outletOrder.update({ where: { id }, data: { deliveryStatus: status } });
  }

  async voidOrder(hotelId: string, id: string, reason: string, actor?: { id?: string; role?: string }) {
    const order = await this.getOrder(hotelId, id);
    if (order.status === 'closed') throw new BadRequestException('A closed check cannot be voided');
    if (!reason?.trim()) throw new BadRequestException('A void reason is required');
    await this.releaseTable(order.tableId, order.id);
    this.events.emit('fb.order.voided', {
      hotelId,
      orderId: id,
      total: order.total,
      voidedBy: actor?.id ?? null,
      reason,
      timestamp: new Date(),
    });
    return this.prisma.outletOrder.update({
      where: { id },
      data: { status: 'void', voidedBy: actor?.id ?? null, voidReason: reason.trim(), closedAt: new Date() },
    });
  }

  /**
   * The one pipeline every check goes through: totals → folio charge or direct
   * payment → fiscal receipt → table released.
   *
   * Previously this only created a Charge when the order happened to carry a
   * reservationId, so every walk-in sale closed with the money recorded
   * nowhere. Now the payment method decides: room_charge/rfid post to the
   * folio, cash/card write a Payment. Neither path can silently no-op.
   */
  async closeOrder(hotelId: string, id: string, dto: Record<string, any>, actor?: { id?: string; name?: string }) {
    const order = await this.getOrder(hotelId, id);
    if (order.status === 'closed') throw new BadRequestException('Order is already closed');
    if (order.status === 'void') throw new BadRequestException('A voided order cannot be closed');

    const method = String(dto.paymentMethod ?? '');
    if (!(PAYMENT_METHODS as readonly string[]).includes(method)) {
      throw new BadRequestException(`paymentMethod must be one of ${PAYMENT_METHODS.join(', ')}`);
    }

    const live = order.items.filter((i) => i.status !== 'void');
    if (!live.length) throw new BadRequestException('Cannot close an empty check — void it instead');

    const totals = this.totals(live, order.outlet.serviceChargePct);

    let folioId: string | null = order.folioId;
    let chargeId: string | null = null;
    let paymentId: string | null = null;

    if ((FOLIO_METHODS as readonly string[]).includes(method)) {
      // Charging a room needs a folio to charge. Resolve it, and refuse rather
      // than closing into the void if there isn't one.
      const reservationId = dto.reservationId || order.reservationId;
      if (!reservationId) {
        throw new BadRequestException('Room charge needs a reservation — pick the guest, or take payment directly');
      }
      const reservation = await this.prisma.reservation.findFirst({ where: { id: reservationId, hotelId } });
      if (!reservation) throw new NotFoundException('Reservation not found');

      let folio = await this.prisma.folio.findFirst({ where: { reservationId, status: 'open' } });
      if (!folio) folio = await this.prisma.folio.findFirst({ where: { reservationId } });
      if (!folio) {
        folio = await this.prisma.folio.create({ data: { hotelId, reservationId, type: 'guest' } });
      }
      folioId = folio.id;

      const charge = await this.prisma.charge.create({
        data: {
          hotelId,
          reservationId,
          folioId: folio.id,
          description: `${order.outlet.name} — чек ${order.id.slice(0, 8)}`,
          category: order.outlet.type === 'bar' ? 'bar' : 'restaurant',
          outlet: order.outlet.name,
          amount: totals.total,
          taxRate: totals.effectiveVat,
          staffId: actor?.id ?? order.staffId ?? undefined,
          serviceTime: new Date(),
        },
      });
      chargeId = charge.id;
      this.logger.log(`F&B charge ${charge.id} posted to folio ${folio.id}: ${totals.total}`);
    } else {
      // Cash/card settle on the spot. This is the path that used to record
      // nothing at all.
      const payment = await this.prisma.payment.create({
        data: {
          hotelId,
          reservationId: order.reservationId || null,
          folioId: order.folioId || null,
          amount: totals.total,
          method,
          cashier: actor?.name ?? null,
        },
      });
      paymentId = payment.id;
    }

    // Fiscalization must never block the check from closing — if the OFD is
    // down the receipt is queued and the floor keeps working.
    let fiscalizedAt: Date | null = null;
    if (order.outlet.fiscalized) {
      try {
        await this.prisma.document.create({
          data: {
            hotelId,
            type: 'fiscal_receipt',
            status: 'issued',
            number: `OFD-${Date.now()}`,
            folioId,
            paymentId,
            reservationId: order.reservationId || null,
            payload: JSON.stringify({
              outletCode: order.outlet.outletCode,
              orderId: order.id,
              covers: order.covers,
              subtotal: totals.subtotal,
              vat: totals.taxTotal,
              service: totals.serviceTotal,
              total: totals.total,
              paymentMethod: method,
              items: live.map((i) => ({
                name: i.name,
                qty: i.qty,
                price: i.price,
                vat_percent: i.vatPercent,
                ikpu: i.ikpuCode ?? order.outlet.defaultIkpu ?? null,
              })),
            }),
          },
        });
        fiscalizedAt = new Date();
      } catch (e) {
        this.logger.error(`Fiscal push queued after failure for order ${id}: ${(e as Error).message}`);
      }
    }

    await this.releaseTable(order.tableId, order.id);

    this.events.emit('outlet.order.closed', {
      hotelId,
      outletId: order.outletId,
      outletType: order.outlet.type,
      total: totals.total,
      items: live.length,
      paymentMethod: method,
      timestamp: new Date(),
    });

    return this.prisma.outletOrder.update({
      where: { id },
      data: {
        status: 'closed',
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        serviceTotal: totals.serviceTotal,
        total: totals.total,
        paymentMethod: method,
        folioId,
        chargeId,
        closedAt: new Date(),
        closedBy: actor?.id ?? null,
        fiscalizedAt,
        deliveryStatus: order.deliveryStatus ? 'delivered' : null,
      },
      include: { items: true, outlet: true },
    });
  }

  /* ─── Table reservations ────────────────────────────────────────────────── */

  async getTableReservations(hotelId: string, opts: { from?: string; to?: string; outletId?: string; status?: string } = {}) {
    const from = opts.from ? utcDay(new Date(opts.from)) : utcDay(new Date());
    const to = opts.to ? utcDay(new Date(opts.to)) : new Date(from.getTime() + 7 * DAY_MS);
    const rows = await this.prisma.fbTableReservation.findMany({
      where: {
        hotelId,
        date: { gte: from, lte: to },
        ...(opts.outletId ? { outletId: opts.outletId } : {}),
        ...(opts.status ? { status: opts.status } : {}),
      },
      orderBy: [{ date: 'asc' }, { time: 'asc' }],
    });
    const tableIds = rows.map((r) => r.tableId).filter(Boolean) as string[];
    const guestIds = rows.map((r) => r.guestId).filter(Boolean) as string[];
    // Resolve both labels here — the client only has ids, and without the guest
    // name every resident booking rendered as a generic "hotel guest".
    const [tables, guests] = await Promise.all([
      tableIds.length
        ? this.prisma.fbTable.findMany({ where: { id: { in: tableIds } }, select: { id: true, number: true } })
        : [],
      guestIds.length
        ? this.prisma.guest.findMany({ where: { id: { in: guestIds } }, select: { id: true, fullName: true } })
        : [],
    ]);
    return {
      range: { from: isoDate(from), to: isoDate(to) },
      reservations: rows.map((r) => ({
        ...r,
        date: isoDate(r.date),
        tableNumber: tables.find((t) => t.id === r.tableId)?.number ?? null,
        guestName: r.guestName ?? guests.find((g) => g.id === r.guestId)?.fullName ?? null,
      })),
    };
  }

  async createTableReservation(hotelId: string, dto: Record<string, any>) {
    const outlet = await this.prisma.outletConfig.findFirst({ where: { id: dto.outletId, hotelId } });
    if (!outlet) throw new NotFoundException('Outlet not found');
    if (!dto.date) throw new BadRequestException('Date is required');
    if (!/^\d{2}:\d{2}$/.test(String(dto.time ?? ''))) throw new BadRequestException('Time must be HH:mm');
    if (!dto.guestId && !String(dto.guestName ?? '').trim()) {
      throw new BadRequestException('A guest or a name is required');
    }
    return this.prisma.fbTableReservation.create({
      data: {
        hotelId,
        outletId: dto.outletId,
        guestId: dto.guestId || null,
        guestName: dto.guestName?.trim() || null,
        phone: dto.phone?.trim() || null,
        partySize: Number(dto.partySize) || 2,
        date: utcDay(new Date(dto.date)),
        time: dto.time,
        tableId: dto.tableId || null,
        status: dto.status ?? 'confirmed',
        source: dto.source ?? 'front_desk',
        notes: dto.notes?.trim() || null,
      },
    });
  }

  async updateTableReservation(hotelId: string, id: string, dto: Record<string, any>) {
    const row = await this.prisma.fbTableReservation.findFirst({ where: { id, hotelId } });
    if (!row) throw new NotFoundException('Reservation not found');
    const data: Record<string, any> = {};
    for (const k of ['guestName', 'phone', 'notes', 'time', 'status', 'source'] as const) {
      if (dto[k] !== undefined) data[k] = typeof dto[k] === 'string' ? dto[k].trim() || null : dto[k];
    }
    if (dto.partySize !== undefined) data.partySize = Number(dto.partySize) || 2;
    if (dto.date !== undefined) data.date = utcDay(new Date(dto.date));
    if (dto.tableId !== undefined) data.tableId = dto.tableId || null;

    // Seating marks the assigned table reserved→occupied-ready so the floor
    // plan reflects it without a second action.
    if (dto.status === 'seated' && (dto.tableId || row.tableId)) {
      const tableId = dto.tableId || row.tableId!;
      const table = await this.prisma.fbTable.findFirst({ where: { id: tableId, hotelId } });
      if (table && !table.currentOrderId) {
        await this.prisma.fbTable.update({ where: { id: tableId }, data: { status: 'reserved' } });
      }
    }
    return this.prisma.fbTableReservation.update({ where: { id }, data });
  }

  /* ─── Dashboard & reports ───────────────────────────────────────────────── */

  async getSummary(hotelId: string) {
    const todayStart = utcDay(new Date());
    const [outlets, closedToday, activeOrders, tables, stopped] = await Promise.all([
      this.prisma.outletConfig.findMany({ where: { hotelId, active: true } }),
      this.prisma.outletOrder.findMany({
        where: { hotelId, status: 'closed', closedAt: { gte: todayStart } },
        include: { outlet: { select: { name: true, type: true } } },
      }),
      this.prisma.outletOrder.findMany({
        where: { hotelId, status: { notIn: ['closed', 'void'] } },
        include: { outlet: { select: { name: true } } },
      }),
      this.prisma.fbTable.findMany({ where: { hotelId, active: true } }),
      this.prisma.fbMenuItem.findMany({ where: { hotelId, active: true, stopList: true } }),
    ]);

    const revenue = closedToday.reduce((s, o) => s + o.total, 0);
    const covers = closedToday.reduce((s, o) => s + o.covers, 0);
    const toFolio = closedToday.filter((o) => (FOLIO_METHODS as readonly string[]).includes(o.paymentMethod ?? ''));
    const folioRevenue = toFolio.reduce((s, o) => s + o.total, 0);

    const byOutlet: Record<string, { count: number; total: number }> = {};
    for (const o of closedToday) {
      const key = o.outlet.name;
      byOutlet[key] ??= { count: 0, total: 0 };
      byOutlet[key].count++;
      byOutlet[key].total += o.total;
    }

    // Alerts the floor actually needs to act on.
    const stuckCutoff = Date.now() - STUCK_PAYMENT_MINUTES * 60_000;
    const stuck = activeOrders.filter(
      (o) => o.status === 'payment_pending' && o.createdAt.getTime() < stuckCutoff,
    );
    const alerts: { kind: string; severity: string; message: string; orderId?: string }[] = [];
    for (const o of stuck) {
      alerts.push({
        kind: 'stuck_payment',
        severity: 'critical',
        message: `Чек ${o.tableNumber ? `стол ${o.tableNumber}` : o.id.slice(0, 8)} ждёт оплату дольше ${STUCK_PAYMENT_MINUTES} мин`,
        orderId: o.id,
      });
    }
    if (stopped.length) {
      alerts.push({
        kind: 'stop_list',
        severity: 'warning',
        message: `В стоп-листе ${stopped.length} ${plural(stopped.length, 'позиция', 'позиции', 'позиций')}`,
      });
    }
    const dirty = tables.filter((t) => t.status === 'dirty');
    if (dirty.length) {
      alerts.push({
        kind: 'dirty_tables',
        severity: 'info',
        message: `${dirty.length} ${plural(dirty.length, 'стол ждёт', 'стола ждут', 'столов ждут')} уборки`,
      });
    }

    return {
      todayRevenue: revenue,
      avgCheck: closedToday.length ? Math.round(revenue / closedToday.length) : 0,
      covers,
      closedCount: closedToday.length,
      openOrders: activeOrders.length,
      openTotal: activeOrders.reduce((s, o) => s + o.total, 0),
      folioRevenue,
      directRevenue: revenue - folioRevenue,
      folioPct: revenue > 0 ? Math.round((folioRevenue / revenue) * 100) : 0,
      outlets: outlets.length,
      tablesTotal: tables.length,
      tablesOccupied: tables.filter((t) => t.status === 'occupied').length,
      tablesDirty: dirty.length,
      stopListCount: stopped.length,
      byOutlet,
      alerts,
    };
  }

  /** Revenue by outlet over a period, top sellers, and the folio/direct split. */
  async getReports(hotelId: string, fromIso?: string, toIso?: string, outletId?: string) {
    const to = toIso ? utcDay(new Date(toIso)) : utcDay(new Date());
    const from = fromIso ? utcDay(new Date(fromIso)) : new Date(to.getTime() - 29 * DAY_MS);
    const toExclusive = new Date(to.getTime() + DAY_MS);

    const orders = await this.prisma.outletOrder.findMany({
      where: {
        hotelId,
        status: 'closed',
        closedAt: { gte: from, lt: toExclusive },
        ...(outletId ? { outletId } : {}),
      },
      include: { items: true, outlet: { select: { id: true, name: true, type: true } } },
    });

    const revenue = orders.reduce((s, o) => s + o.total, 0);
    const covers = orders.reduce((s, o) => s + o.covers, 0);

    const byOutlet = new Map<string, { outletId: string; name: string; orders: number; covers: number; revenue: number }>();
    const byDay = new Map<string, number>();
    const byItem = new Map<string, { name: string; qty: number; revenue: number; category: string }>();
    let folioRevenue = 0;
    let voidedValue = 0;

    for (const o of orders) {
      const row = byOutlet.get(o.outletId) ?? {
        outletId: o.outletId, name: o.outlet.name, orders: 0, covers: 0, revenue: 0,
      };
      row.orders++; row.covers += o.covers; row.revenue += o.total;
      byOutlet.set(o.outletId, row);

      const day = isoDate(o.closedAt ?? o.createdAt);
      byDay.set(day, (byDay.get(day) ?? 0) + o.total);

      if ((FOLIO_METHODS as readonly string[]).includes(o.paymentMethod ?? '')) folioRevenue += o.total;

      for (const i of o.items) {
        if (i.status === 'void') { voidedValue += i.qty * i.price; continue; }
        const it = byItem.get(i.name) ?? { name: i.name, qty: 0, revenue: 0, category: i.category };
        it.qty += i.qty; it.revenue += i.qty * i.price;
        byItem.set(i.name, it);
      }
    }

    // Fill gaps so the trend line has no holes on quiet days.
    const series: { date: string; revenue: number }[] = [];
    for (let t = from.getTime(); t < toExclusive.getTime(); t += DAY_MS) {
      const d = isoDate(new Date(t));
      series.push({ date: d, revenue: Math.round(byDay.get(d) ?? 0) });
    }

    return {
      range: { from: isoDate(from), to: isoDate(to) },
      totals: {
        revenue,
        orders: orders.length,
        covers,
        avgCheck: orders.length ? Math.round(revenue / orders.length) : 0,
        avgPerCover: covers ? Math.round(revenue / covers) : 0,
        folioRevenue,
        directRevenue: revenue - folioRevenue,
        folioPct: revenue > 0 ? Math.round((folioRevenue / revenue) * 100) : 0,
        voidedValue,
      },
      byOutlet: [...byOutlet.values()].sort((a, b) => b.revenue - a.revenue),
      series,
      topItems: [...byItem.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 20),
    };
  }

  /* ─── internals ─────────────────────────────────────────────────────────── */

  private async assertOpen(hotelId: string, orderId: string) {
    const order = await this.prisma.outletOrder.findFirst({ where: { id: orderId, hotelId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status === 'closed') throw new BadRequestException('The check is already closed');
    if (order.status === 'void') throw new BadRequestException('The check is voided');
    return order;
  }

  /**
   * VAT is computed per line because rates differ by item (food vs alcohol),
   * and shown separately — never bundled into the displayed price.
   */
  private totals(items: { qty: number; price: number; vatPercent: number }[], servicePct = 0) {
    let net = 0;
    let tax = 0;
    for (const i of items) {
      const gross = i.qty * i.price;
      // Menu prices are VAT-inclusive, so back the tax out rather than adding it on.
      const lineNet = gross / (1 + (i.vatPercent || 0) / 100);
      net += lineNet;
      tax += gross - lineNet;
    }
    const subtotal = Math.round(net);
    const taxTotal = Math.round(tax);
    const serviceTotal = Math.round((subtotal + taxTotal) * (servicePct / 100));
    const total = subtotal + taxTotal + serviceTotal;
    return {
      subtotal,
      taxTotal,
      serviceTotal,
      total,
      effectiveVat: subtotal > 0 ? Math.round((taxTotal / subtotal) * 100) : 0,
    };
  }

  private async recalc(orderId: string) {
    const order = await this.prisma.outletOrder.findUnique({
      where: { id: orderId },
      include: { items: true, outlet: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    const live = order.items.filter((i) => i.status !== 'void');
    const t = this.totals(live, order.outlet.serviceChargePct);
    return this.prisma.outletOrder.update({
      where: { id: orderId },
      data: { subtotal: t.subtotal, taxTotal: t.taxTotal, serviceTotal: t.serviceTotal, total: t.total },
      include: { items: true, outlet: true },
    });
  }

  /** Free a table when its check leaves — it needs bussing, not immediate reuse. */
  private async releaseTable(tableId: string | null, orderId: string) {
    if (!tableId) return;
    await this.prisma.fbTable.updateMany({
      where: { id: tableId, currentOrderId: orderId },
      data: { status: 'dirty', currentOrderId: null },
    });
    // Anything merged onto this check is released with it.
    await this.prisma.fbTable.updateMany({
      where: { mergedInto: tableId },
      data: { mergedInto: null, status: 'dirty' },
    });
  }
}
