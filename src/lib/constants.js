// Constants shared by client and server code (kept free of server-only imports).
export const TRIP_STATUSES = ['Draft', 'Submitted', 'Pending for Review', 'Under Approval', 'Approved', 'Booking In Progress', 'Travel In Progress', 'Expenses Pending', 'Closed', 'Rejected', 'Cancelled'];
export const PURPOSES = ['Client meeting', 'Project / site visit', 'Training / conference', 'Internal meeting'];
export const TRAVEL_MODES = ['Flight', 'Train', 'Company cab', 'Rental cab', 'Personal cab', 'Bus', 'Other'];
export const AIRPORTS = [['BBI', 'Bhubaneswar (BBI)'], ['BOM', 'Mumbai (BOM)'], ['DEL', 'Delhi (DEL)'], ['BLR', 'Bengaluru (BLR)'], ['CCU', 'Kolkata (CCU)'], ['HYD', 'Hyderabad (HYD)'], ['MAA', 'Chennai (MAA)'], ['PNQ', 'Pune (PNQ)'], ['GOI', 'Goa (GOI)'], ['SIN', 'Singapore (SIN)'], ['DXB', 'Dubai (DXB)'], ['LHR', 'London (LHR)']];
export const AIRPORT_OF_CITY = { Bhubaneswar: 'BBI', Mumbai: 'BOM', Delhi: 'DEL', Bengaluru: 'BLR', Kolkata: 'CCU', Hyderabad: 'HYD', Chennai: 'MAA', Pune: 'PNQ', Goa: 'GOI', Singapore: 'SIN', Dubai: 'DXB', London: 'LHR' };
export const EXPENSE_TYPES = ['Air Fare', 'Hotel', 'Cab Fare', 'Meals', 'Bus', 'Train Fare', 'Fuel', 'Parking', 'Internet', 'Conference Fee', 'Miscellaneous'];
