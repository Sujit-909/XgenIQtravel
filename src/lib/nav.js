// Role-based navigation (follows the navigation recommendation table + the screen designs).
const common = [{ label: 'Notifications', href: '/notifications', icon: 'bell', badge: 'unread' }];
const profile = [{ label: 'My Profile', href: '/profile', icon: 'user' }, { label: 'Help & Support', href: '/help', icon: 'help' }];

export function navFor(user) {
  switch (user.role) {
    case 'manager':
      return [
        { label: 'Dashboard', href: '/dashboard', icon: 'home' },
        { label: 'Team Trips', href: '/trips', icon: 'plane' },
        { label: 'New Trip Request', href: '/trips/new', icon: 'edit' },
        { label: 'Approvals', href: '/approvals', icon: 'checkCircle', badge: 'pending' },
        { label: 'Team Travel Bookings', href: '/team/bookings', icon: 'list' },
        { label: 'Policy Exceptions', href: '/approvals?type=booking', icon: 'shield' },
        { label: 'Trip Readiness', href: '/readiness', icon: 'clock' },
        { label: 'Team Travel Compliance', href: '/team/compliance', icon: 'users' },
        { label: 'My Bookings', href: '/bookings', icon: 'briefcase' },
        { label: 'Expense Reports', href: '/expenses', icon: 'file' },
        { label: 'Cancellation & Refunds', href: '/refunds', icon: 'refresh' },
        { label: 'Reports', href: '/reports', icon: 'chart' },
        { label: 'Travel Policy', href: '/policy', icon: 'shield' }, ...common, ...profile,
      ];
    case 'travel_desk':
      return [
        { label: 'Dashboard', href: '/dashboard', icon: 'home' },
        { label: 'Operations Queue', href: '/travel-desk', icon: 'hourglass' },
        { label: 'Booking Requests', href: '/travel-desk?tab=All', icon: 'list' },
        { label: 'Quotes Awaiting Decision', href: '/travel-desk?tab=Traveller%20Info', icon: 'rupee' },
        { label: 'Ticketing Pending', href: '/travel-desk?tab=Ticketing%20Pending', icon: 'file' },
        { label: 'Changes & Cancellations', href: '/refunds', icon: 'refresh' },
        { label: 'Supplier SLA', href: '/travel-desk/sla', icon: 'clock' },
        { label: 'Trip Readiness', href: '/readiness', icon: 'plane' },
        { label: 'Team Travel Compliance', href: '/team/compliance', icon: 'users' },
        { label: 'Reports', href: '/reports', icon: 'chart' }, ...common, ...profile,
      ];
    case 'finance':
      return [
        { label: 'Dashboard', href: '/dashboard', icon: 'home' },
        { label: 'Expense Approvals', href: '/approvals?type=expense', icon: 'checkCircle', badge: 'pending' },
        { label: 'Reimbursement Tracker', href: '/finance/reimbursements', icon: 'rupee' },
        { label: 'Payment Reconciliation', href: '/finance/reconciliation', icon: 'building' },
        { label: 'Supplier Invoices', href: '/finance/reconciliation?tab=invoices', icon: 'file' },
        { label: 'Refund Reconciliation', href: '/refunds', icon: 'refresh' },
        { label: 'Cost Allocation Exceptions', href: '/finance/reconciliation?tab=exceptions', icon: 'alert' },
        { label: 'Expense Reports', href: '/expenses', icon: 'receipt' },
        { label: 'Reports', href: '/reports', icon: 'chart' }, ...common, ...profile,
      ];
    case 'admin':
      return [
        { label: 'Dashboard', href: '/dashboard', icon: 'home' },
        { label: 'Travel Policy', href: '/policy', icon: 'shield' },
        { label: 'Approval Matrix', href: '/policy?tab=workflows', icon: 'checkCircle' },
        { label: 'Supplier Configuration', href: '/policy?tab=suppliers', icon: 'building' },
        { label: 'Master Data', href: '/master-data', icon: 'list' },
        { label: 'User Management', href: '/users', icon: 'users' },
        { label: 'Integrations', href: '/integrations', icon: 'link' },
        { label: 'Audit Logs', href: '/audit', icon: 'file' },
        { label: 'Trip Readiness', href: '/readiness', icon: 'plane' },
        { label: 'Reports', href: '/reports', icon: 'chart' }, ...common, ...profile,
      ];
    default:
      return [
        { label: 'Dashboard', href: '/dashboard', icon: 'home' },
        { label: 'Travel Assistant', href: '/assistant', icon: 'bot' },
        { label: 'My Trips', href: '/trips', icon: 'plane' },
        { label: 'Travel Request', href: '/trips/new', icon: 'edit' },
        { label: 'Bookings & Services', href: '/services/flight', icon: 'briefcase', group: [['Flight Booking', '/services/flight'], ['Hotel Booking', '/services/hotel'], ['Ground Transport', '/services/ground'], ['Visa Processing', '/services/visa'], ['Other Services', '/services/other']] },
        { label: 'My Bookings', href: '/bookings', icon: 'list' },
        { label: 'Expense Reports', href: '/expenses', icon: 'file' },
        ...(user.hasReports ? [{ label: 'Approvals', href: '/approvals', icon: 'checkCircle', badge: 'pending' }] : []),
        { label: 'Travel Documents', href: '/documents', icon: 'card' },
        { label: 'Reimbursement Accounts', href: '/reimbursement-accounts', icon: 'building' },
        { label: 'Loyalty Programs', href: '/loyalty', icon: 'trophy' },
        { label: 'Cancellation & Refunds', href: '/refunds', icon: 'refresh' },
        { label: 'Travel Policy', href: '/policy', icon: 'shield' }, ...common, ...profile,
      ];
  }
}
