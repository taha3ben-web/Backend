CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "UserType" AS ENUM ('PASSENGER', 'DRIVER', 'STAFF', 'AGENT');

CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BANNED', 'PENDING');

CREATE TYPE "DriverStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'BANNED');

CREATE TYPE "DriverAvailability" AS ENUM ('OFFLINE', 'ONLINE', 'ON_TRIP');

CREATE TYPE "RideClass" AS ENUM ('ECONOMY', 'COMFORT', 'VAN', 'XL', 'CAR', 'BIKE');

CREATE TYPE "WorkflowStatus" AS ENUM ('DRAFT', 'PENDING', 'PUBLISHED', 'ARCHIVED');

CREATE TYPE "DocumentType" AS ENUM ('LICENSE', 'ID_CARD', 'INSURANCE', 'REGISTRATION', 'PROFILE_PHOTO');

CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TYPE "TripStatus" AS ENUM ('SEARCHING', 'ACCEPTED', 'ARRIVING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

CREATE TYPE "ActorKind" AS ENUM ('PASSENGER', 'DRIVER', 'SYSTEM', 'STAFF');

CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'WALLET');

CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'CAPTURED', 'PAID', 'FAILED', 'REFUNDED', 'CANCELED');

CREATE TYPE "WithdrawStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PAID');

CREATE TYPE "FundingRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'FUNDED');

CREATE TYPE "WalletTxType" AS ENUM ('CREDIT', 'DEBIT');

CREATE TYPE "FinancialPartyType" AS ENUM ('USER', 'AGENT', 'PLATFORM', 'EXTERNAL');

CREATE TYPE "FinancialAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

CREATE TYPE "LedgerTransactionStatus" AS ENUM ('PENDING', 'POSTED', 'FAILED', 'REVERSED', 'CANCELLED');

CREATE TYPE "LedgerEntryDirection" AS ENUM ('DEBIT', 'CREDIT');

CREATE TYPE "AgentStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'INVITED');

CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FIXED');

CREATE TYPE "NotificationTarget" AS ENUM ('ALL', 'DRIVERS', 'PASSENGERS', 'USER');

CREATE TYPE "NotificationChannel" AS ENUM ('PUSH', 'SMS', 'EMAIL', 'IN_APP');

CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'PENDING', 'RESOLVED', 'CLOSED');

CREATE TYPE "ComplaintStatus" AS ENUM ('OPEN', 'REVIEWING', 'RESOLVED');

CREATE TYPE "AdPlacement" AS ENUM ('PASSENGER_HOME', 'PASSENGER_SEARCH', 'DRIVER_HOME', 'ALL');

CREATE TABLE "User" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL UNIQUE,
  "email" TEXT UNIQUE,
  "passwordHash" TEXT NOT NULL,
  "firebaseUid" TEXT UNIQUE,
  "type" "UserType" DEFAULT 'PASSENGER' NOT NULL,
  "status" "UserStatus" DEFAULT 'ACTIVE' NOT NULL,
  "avatarUrl" TEXT,
  "locale" TEXT DEFAULT 'ar' NOT NULL,
  "staffRoleId" TEXT,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "Driver" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL UNIQUE,
  "status" "DriverStatus" DEFAULT 'PENDING' NOT NULL,
  "availability" "DriverAvailability" DEFAULT 'OFFLINE' NOT NULL,
  "rating" DOUBLE PRECISION DEFAULT 5 NOT NULL,
  "totalTrips" INTEGER DEFAULT 0 NOT NULL,
  "cityId" TEXT,
  "currentLat" DOUBLE PRECISION,
  "currentLng" DOUBLE PRECISION,
  "lastSeenAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "Vehicle" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "driverId" TEXT NOT NULL,
  "make" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "year" INTEGER,
  "color" TEXT,
  "plate" TEXT NOT NULL UNIQUE,
  "rideClass" "RideClass" DEFAULT 'ECONOMY' NOT NULL,
  "vehicleTypeId" TEXT,
  "isActive" BOOLEAN DEFAULT TRUE NOT NULL,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "DriverDocument" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "driverId" TEXT NOT NULL,
  "type" "DocumentType" NOT NULL,
  "url" TEXT NOT NULL,
  "status" "DocumentStatus" DEFAULT 'PENDING' NOT NULL,
  "reviewedById" TEXT,
  "note" TEXT,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "Trip" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "passengerId" TEXT NOT NULL,
  "driverId" TEXT,
  "status" "TripStatus" DEFAULT 'SEARCHING' NOT NULL,
  "rideClass" "RideClass" DEFAULT 'ECONOMY' NOT NULL,
  "vehicleTypeId" TEXT,
  "pickupLat" DOUBLE PRECISION NOT NULL,
  "pickupLng" DOUBLE PRECISION NOT NULL,
  "pickupAddress" TEXT,
  "destLat" DOUBLE PRECISION,
  "destLng" DOUBLE PRECISION,
  "destAddress" TEXT,
  "distanceKm" DOUBLE PRECISION,
  "durationSec" INTEGER,
  "fare" DECIMAL(12, 2),
  "currency" TEXT DEFAULT 'DZD' NOT NULL,
  "paymentMethod" "PaymentMethod" DEFAULT 'CASH' NOT NULL,
  "cancelReason" TEXT,
  "cancelledBy" "ActorKind",
  "cityId" TEXT,
  "couponId" TEXT,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "settlementAttempts" INTEGER DEFAULT 0 NOT NULL,
  "settlementError" TEXT,
  "settledAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "TripTracking" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "tripId" TEXT NOT NULL,
  "lat" DOUBLE PRECISION NOT NULL,
  "lng" DOUBLE PRECISION NOT NULL,
  "heading" DOUBLE PRECISION,
  "speed" DOUBLE PRECISION,
  "recordedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "TripEvent" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "tripId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "actor" "ActorKind" DEFAULT 'SYSTEM' NOT NULL,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "FinancialParty" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "type" "FinancialPartyType" NOT NULL,
  "userId" TEXT UNIQUE,
  "displayName" TEXT NOT NULL,
  "countryCode" TEXT DEFAULT 'DZ' NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "FinancialAccount" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "partyId" TEXT NOT NULL,
  "code" TEXT NOT NULL UNIQUE,
  "type" "FinancialAccountType" NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "balanceCache" DECIMAL(18, 2) DEFAULT 0 NOT NULL,
  "isActive" BOOLEAN DEFAULT TRUE NOT NULL,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "LedgerTransaction" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "command" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "status" "LedgerTransactionStatus" DEFAULT 'PENDING' NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "referenceType" TEXT,
  "referenceId" TEXT,
  "metadata" JSONB,
  "failureReason" TEXT,
  "reversalOfId" TEXT UNIQUE,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "postedAt" TIMESTAMP(3)
);

CREATE TABLE "LedgerEntry" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "transactionId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "direction" "LedgerEntryDirection" NOT NULL,
  "amount" DECIMAL(18, 2) NOT NULL,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  UNIQUE ("transactionId", "accountId", "direction")
);

CREATE TABLE "DriverEarning" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "driverId" TEXT NOT NULL,
  "tripId" TEXT NOT NULL UNIQUE,
  "gross" DECIMAL(12, 2) NOT NULL,
  "commission" DECIMAL(12, 2) NOT NULL,
  "net" DECIMAL(12, 2) NOT NULL,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "CompanyEarning" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "tripId" TEXT NOT NULL UNIQUE,
  "amount" DECIMAL(12, 2) NOT NULL,
  "source" TEXT DEFAULT 'commission' NOT NULL,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "Payment" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "tripId" TEXT NOT NULL UNIQUE,
  "userId" TEXT NOT NULL,
  "amount" DECIMAL(12, 2) NOT NULL,
  "method" "PaymentMethod" DEFAULT 'CASH' NOT NULL,
  "provider" TEXT DEFAULT 'manual' NOT NULL,
  "providerPaymentId" TEXT,
  "providerStatus" TEXT,
  "status" "PaymentStatus" DEFAULT 'PENDING' NOT NULL,
  "statusReason" TEXT,
  "reference" TEXT,
  "metadata" JSONB,
  "authorizedAt" TIMESTAMP(3),
  "capturedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "refundedAt" TIMESTAMP(3),
  "canceledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "PaymentEvent" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "paymentId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT,
  "provider" TEXT,
  "idempotencyKey" TEXT UNIQUE,
  "reference" TEXT,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "Wallet" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL UNIQUE,
  "balance" DECIMAL(12, 2) DEFAULT 0 NOT NULL,
  "currency" TEXT DEFAULT 'DZD' NOT NULL,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "WalletTransaction" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "walletId" TEXT NOT NULL,
  "type" "WalletTxType" NOT NULL,
  "amount" DECIMAL(12, 2) NOT NULL,
  "balanceAfter" DECIMAL(12, 2) NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "DriverFundingRequest" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "driverId" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "approvedById" TEXT,
  "amount" DECIMAL(12, 2) NOT NULL,
  "status" "FundingRequestStatus" DEFAULT 'PENDING' NOT NULL,
  "note" TEXT,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "approvedAt" TIMESTAMP(3),
  "fundedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "WithdrawRequest" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "driverId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "amount" DECIMAL(12, 2) NOT NULL,
  "status" "WithdrawStatus" DEFAULT 'PENDING' NOT NULL,
  "processedById" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "processedAt" TIMESTAMP(3)
);

CREATE TABLE "Coupon" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "code" TEXT NOT NULL UNIQUE,
  "type" "DiscountType" DEFAULT 'PERCENT' NOT NULL,
  "value" DECIMAL(12, 2) NOT NULL,
  "maxUses" INTEGER,
  "usedCount" INTEGER DEFAULT 0 NOT NULL,
  "firstRideOnly" BOOLEAN DEFAULT FALSE NOT NULL,
  "userId" TEXT,
  "expiresAt" TIMESTAMP(3),
  "isActive" BOOLEAN DEFAULT TRUE NOT NULL,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "PromoCode" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "code" TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "discountType" "DiscountType" DEFAULT 'PERCENT' NOT NULL,
  "value" DECIMAL(12, 2) NOT NULL,
  "isActive" BOOLEAN DEFAULT TRUE NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "Notification" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "target" "NotificationTarget" DEFAULT 'USER' NOT NULL,
  "channel" "NotificationChannel" DEFAULT 'PUSH' NOT NULL,
  "userId" TEXT,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "data" JSONB,
  "scheduledAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "SupportTicket" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "category" TEXT,
  "status" "TicketStatus" DEFAULT 'OPEN' NOT NULL,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "SupportMessage" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "ticketId" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "Rating" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "tripId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "stars" INTEGER NOT NULL,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "Complaint" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "tripId" TEXT,
  "fromUserId" TEXT NOT NULL,
  "againstUserId" TEXT,
  "message" TEXT NOT NULL,
  "status" "ComplaintStatus" DEFAULT 'OPEN' NOT NULL,
  "resolvedById" TEXT,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "resolvedAt" TIMESTAMP(3)
);

CREATE TABLE "AgentProfile" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL UNIQUE,
  "agentCode" TEXT NOT NULL UNIQUE,
  "status" "AgentStatus" DEFAULT 'ACTIVE' NOT NULL,
  "cityId" TEXT,
  "notes" TEXT,
  "createdById" TEXT,
  "lastLoginAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "Role" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "Permission" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "key" TEXT NOT NULL UNIQUE,
  "description" TEXT
);

CREATE TABLE "RolePermission" (
  "roleId" TEXT NOT NULL,
  "permissionId" TEXT NOT NULL,
  PRIMARY KEY ("roleId", "permissionId")
);

CREATE TABLE "City" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "country" TEXT,
  "isActive" BOOLEAN DEFAULT TRUE NOT NULL,
  "centerLat" DOUBLE PRECISION,
  "centerLng" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "Zone" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "cityId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "polygon" JSONB,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "PricingRule" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "cityId" TEXT,
  "rideClass" "RideClass" DEFAULT 'ECONOMY' NOT NULL,
  "baseFare" DECIMAL(12, 2) NOT NULL,
  "perKm" DECIMAL(12, 2) NOT NULL,
  "perMin" DECIMAL(12, 2) NOT NULL,
  "minFare" DECIMAL(12, 2) NOT NULL,
  "maxFare" DECIMAL(12, 2),
  "currency" TEXT DEFAULT 'DZD' NOT NULL,
  "isActive" BOOLEAN DEFAULT TRUE NOT NULL,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "PeakPricing" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "pricingRuleId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "multiplier" DOUBLE PRECISION DEFAULT 1.5 NOT NULL,
  "startTime" TEXT NOT NULL,
  "endTime" TEXT NOT NULL,
  "daysOfWeek" INTEGER[] NOT NULL,
  "isActive" BOOLEAN DEFAULT TRUE NOT NULL,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "EmergencyContact" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "relation" TEXT,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "Setting" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "key" TEXT NOT NULL UNIQUE,
  "value" JSONB NOT NULL,
  "group" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "AppVersion" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "platform" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "minSupported" TEXT,
  "forceUpdate" BOOLEAN DEFAULT FALSE NOT NULL,
  "url" TEXT,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "DeviceToken" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "platform" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "RefreshToken" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "revoked" BOOLEAN DEFAULT FALSE NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "Session" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "ip" TEXT,
  "userAgent" TEXT,
  "lastSeenAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "AuditLog" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "entity" TEXT,
  "entityId" TEXT,
  "ip" TEXT,
  "userAgent" TEXT,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "ActivityLog" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "userId" TEXT,
  "action" TEXT NOT NULL,
  "ip" TEXT,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "SystemLog" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "level" TEXT DEFAULT 'info' NOT NULL,
  "message" TEXT NOT NULL,
  "context" TEXT,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "VehicleCategory" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "nameI18n" JSONB,
  "description" TEXT,
  "descriptionI18n" JSONB,
  "iconType" TEXT DEFAULT 'EMOJI' NOT NULL,
  "iconValue" TEXT,
  "iconUrl" TEXT,
  "imageUrl" TEXT,
  "color" TEXT,
  "usageType" TEXT DEFAULT 'BOTH' NOT NULL,
  "domain" TEXT DEFAULT 'MOBILITY' NOT NULL,
  "status" "WorkflowStatus" DEFAULT 'PUBLISHED' NOT NULL,
  "version" INTEGER DEFAULT 1 NOT NULL,
  "isActive" BOOLEAN DEFAULT TRUE NOT NULL,
  "sortOrder" INTEGER DEFAULT 0 NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "VehicleType" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "categoryId" TEXT,
  "name" TEXT NOT NULL,
  "nameI18n" JSONB,
  "description" TEXT,
  "descriptionI18n" JSONB,
  "rideClass" "RideClass" DEFAULT 'ECONOMY' NOT NULL,
  "multiplier" DOUBLE PRECISION DEFAULT 1 NOT NULL,
  "capacity" INTEGER DEFAULT 4 NOT NULL,
  "luggage" INTEGER DEFAULT 0 NOT NULL,
  "notes" TEXT,
  "usageType" TEXT DEFAULT 'BOTH' NOT NULL,
  "allowsNegotiation" BOOLEAN DEFAULT FALSE NOT NULL,
  "supportsCash" BOOLEAN DEFAULT TRUE NOT NULL,
  "supportsWallet" BOOLEAN DEFAULT TRUE NOT NULL,
  "requiresApproval" BOOLEAN DEFAULT FALSE NOT NULL,
  "visibleToPassengers" BOOLEAN DEFAULT TRUE NOT NULL,
  "visibleToDrivers" BOOLEAN DEFAULT TRUE NOT NULL,
  "iconType" TEXT DEFAULT 'EMOJI' NOT NULL,
  "iconValue" TEXT,
  "iconUrl" TEXT,
  "imageUrl" TEXT,
  "color" TEXT,
  "minVehicleYear" INTEGER,
  "minDriverRating" DOUBLE PRECISION,
  "minDriverTrips" INTEGER,
  "requiredLicenseType" TEXT,
  "requiredDocuments" TEXT[] DEFAULT ARRAY[]::TEXT[] NOT NULL,
  "requiredPhotos" TEXT[] DEFAULT ARRAY[]::TEXT[] NOT NULL,
  "requirements" JSONB,
  "status" "WorkflowStatus" DEFAULT 'DRAFT' NOT NULL,
  "version" INTEGER DEFAULT 1 NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "isActive" BOOLEAN DEFAULT TRUE NOT NULL,
  "sortOrder" INTEGER DEFAULT 0 NOT NULL,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  UNIQUE ("categoryId", "name")
);

CREATE TABLE "Feature" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "code" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "nameI18n" JSONB,
  "iconType" TEXT DEFAULT 'EMOJI' NOT NULL,
  "iconValue" TEXT,
  "iconUrl" TEXT,
  "isActive" BOOLEAN DEFAULT TRUE NOT NULL,
  "sortOrder" INTEGER DEFAULT 0 NOT NULL,
  "version" INTEGER DEFAULT 1 NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "VehicleTypeFeature" (
  "vehicleTypeId" TEXT NOT NULL,
  "featureId" TEXT NOT NULL,
  PRIMARY KEY ("vehicleTypeId", "featureId")
);

CREATE TABLE "ServiceArea" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "city" TEXT,
  "state" TEXT,
  "country" TEXT,
  "geojson" JSONB,
  "provider" TEXT DEFAULT 'GEOJSON' NOT NULL,
  "providerRef" JSONB,
  "centerLat" DOUBLE PRECISION,
  "centerLng" DOUBLE PRECISION,
  "isActive" BOOLEAN DEFAULT TRUE NOT NULL,
  "sortOrder" INTEGER DEFAULT 0 NOT NULL,
  "version" INTEGER DEFAULT 1 NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "VehiclePricingRule" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "vehicleTypeId" TEXT NOT NULL,
  "name" TEXT,
  "serviceAreaId" TEXT,
  "cityId" TEXT,
  "state" TEXT,
  "country" TEXT,
  "customerType" TEXT,
  "couponCode" TEXT,
  "validFrom" TIMESTAMP(3),
  "validTo" TIMESTAMP(3),
  "daysOfWeek" INTEGER[] DEFAULT ARRAY[]::INTEGER[] NOT NULL,
  "startTime" TEXT,
  "endTime" TEXT,
  "peakMultiplier" DOUBLE PRECISION DEFAULT 1 NOT NULL,
  "baseFare" DECIMAL(12, 2) NOT NULL,
  "perKm" DECIMAL(12, 2) NOT NULL,
  "perMin" DECIMAL(12, 2) NOT NULL,
  "minFare" DECIMAL(12, 2) NOT NULL,
  "maxFare" DECIMAL(12, 2),
  "negotiationMin" DECIMAL(12, 2),
  "negotiationMax" DECIMAL(12, 2),
  "commissionPct" DOUBLE PRECISION DEFAULT 0 NOT NULL,
  "currency" TEXT DEFAULT 'DZD' NOT NULL,
  "priority" INTEGER DEFAULT 0 NOT NULL,
  "isActive" BOOLEAN DEFAULT TRUE NOT NULL,
  "version" INTEGER DEFAULT 1 NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "VehicleTypeField" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "vehicleTypeId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "labelI18n" JSONB,
  "fieldType" TEXT DEFAULT 'TEXT' NOT NULL,
  "options" JSONB,
  "required" BOOLEAN DEFAULT FALSE NOT NULL,
  "isActive" BOOLEAN DEFAULT TRUE NOT NULL,
  "sortOrder" INTEGER DEFAULT 0 NOT NULL,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  UNIQUE ("vehicleTypeId", "key")
);

CREATE TABLE "Advertisement" (
  "id" TEXT DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "targetUrl" TEXT,
  "placement" "AdPlacement" DEFAULT 'PASSENGER_HOME' NOT NULL,
  "isActive" BOOLEAN DEFAULT TRUE NOT NULL,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "sortOrder" INTEGER DEFAULT 0 NOT NULL,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

ALTER TABLE "User" ADD CONSTRAINT "User_staffRoleId_fkey" FOREIGN KEY ("staffRoleId") REFERENCES "Role" ("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "AgentProfile" ADD CONSTRAINT "AgentProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentProfile" ADD CONSTRAINT "AgentProfile_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AgentProfile" ADD CONSTRAINT "AgentProfile_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Driver" ADD CONSTRAINT "Driver_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Driver" ADD CONSTRAINT "Driver_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City" ("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_vehicleTypeId_fkey" FOREIGN KEY ("vehicleTypeId") REFERENCES "VehicleType" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DriverDocument" ADD CONSTRAINT "DriverDocument_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DriverDocument" ADD CONSTRAINT "DriverDocument_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User" ("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "Trip" ADD CONSTRAINT "Trip_passengerId_fkey" FOREIGN KEY ("passengerId") REFERENCES "User" ("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "Trip" ADD CONSTRAINT "Trip_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "Trip" ADD CONSTRAINT "Trip_vehicleTypeId_fkey" FOREIGN KEY ("vehicleTypeId") REFERENCES "VehicleType" ("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "Trip" ADD CONSTRAINT "Trip_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City" ("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "Trip" ADD CONSTRAINT "Trip_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon" ("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "TripTracking" ADD CONSTRAINT "TripTracking_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TripEvent" ADD CONSTRAINT "TripEvent_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FinancialParty" ADD CONSTRAINT "FinancialParty_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FinancialAccount" ADD CONSTRAINT "FinancialAccount_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "FinancialParty" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "LedgerTransaction" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "LedgerTransaction" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinancialAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DriverEarning" ADD CONSTRAINT "DriverEarning_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "DriverEarning" ADD CONSTRAINT "DriverEarning_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip" ("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "CompanyEarning" ADD CONSTRAINT "CompanyEarning_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip" ("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip" ("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DriverFundingRequest" ADD CONSTRAINT "DriverFundingRequest_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "DriverFundingRequest" ADD CONSTRAINT "DriverFundingRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User" ("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "DriverFundingRequest" ADD CONSTRAINT "DriverFundingRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User" ("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "WithdrawRequest" ADD CONSTRAINT "WithdrawRequest_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "WithdrawRequest" ADD CONSTRAINT "WithdrawRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User" ("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "Rating" ADD CONSTRAINT "Rating_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip" ("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "Rating" ADD CONSTRAINT "Rating_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "Rating" ADD CONSTRAINT "Rating_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User" ("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip" ("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User" ("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_againstUserId_fkey" FOREIGN KEY ("againstUserId") REFERENCES "User" ("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User" ("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Zone" ADD CONSTRAINT "Zone_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City" ("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "PeakPricing" ADD CONSTRAINT "PeakPricing_pricingRuleId_fkey" FOREIGN KEY ("pricingRuleId") REFERENCES "PricingRule" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmergencyContact" ADD CONSTRAINT "EmergencyContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "VehicleType" ADD CONSTRAINT "VehicleType_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "VehicleCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VehicleTypeFeature" ADD CONSTRAINT "VehicleTypeFeature_vehicleTypeId_fkey" FOREIGN KEY ("vehicleTypeId") REFERENCES "VehicleType" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VehicleTypeFeature" ADD CONSTRAINT "VehicleTypeFeature_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VehiclePricingRule" ADD CONSTRAINT "VehiclePricingRule_vehicleTypeId_fkey" FOREIGN KEY ("vehicleTypeId") REFERENCES "VehicleType" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VehiclePricingRule" ADD CONSTRAINT "VehiclePricingRule_serviceAreaId_fkey" FOREIGN KEY ("serviceAreaId") REFERENCES "ServiceArea" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VehicleTypeField" ADD CONSTRAINT "VehicleTypeField_vehicleTypeId_fkey" FOREIGN KEY ("vehicleTypeId") REFERENCES "VehicleType" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "User_type_idx" ON "User" ("type");

CREATE INDEX "User_status_idx" ON "User" ("status");

CREATE INDEX "Driver_status_idx" ON "Driver" ("status");

CREATE INDEX "Driver_availability_idx" ON "Driver" ("availability");

CREATE INDEX "Driver_availability_status_idx" ON "Driver" ("availability", "status");

CREATE INDEX "Driver_cityId_idx" ON "Driver" ("cityId");

CREATE INDEX "Vehicle_driverId_idx" ON "Vehicle" ("driverId");

CREATE INDEX "Vehicle_vehicleTypeId_idx" ON "Vehicle" ("vehicleTypeId");

CREATE INDEX "DriverDocument_driverId_idx" ON "DriverDocument" ("driverId");

CREATE INDEX "DriverDocument_status_idx" ON "DriverDocument" ("status");

CREATE INDEX "Trip_status_idx" ON "Trip" ("status");

CREATE INDEX "Trip_passengerId_idx" ON "Trip" ("passengerId");

CREATE INDEX "Trip_driverId_idx" ON "Trip" ("driverId");

CREATE INDEX "Trip_passengerId_status_idx" ON "Trip" ("passengerId", "status");

CREATE INDEX "Trip_driverId_status_idx" ON "Trip" ("driverId", "status");

CREATE INDEX "Trip_createdAt_idx" ON "Trip" ("createdAt");

CREATE INDEX "Trip_status_settledAt_completedAt_idx" ON "Trip" ("status", "settledAt", "completedAt");

CREATE INDEX "TripTracking_tripId_recordedAt_idx" ON "TripTracking" ("tripId", "recordedAt");

CREATE INDEX "TripEvent_tripId_createdAt_idx" ON "TripEvent" ("tripId", "createdAt");

CREATE INDEX "FinancialParty_type_idx" ON "FinancialParty" ("type");

CREATE INDEX "FinancialAccount_partyId_currency_idx" ON "FinancialAccount" ("partyId", "currency");

CREATE INDEX "LedgerTransaction_status_createdAt_idx" ON "LedgerTransaction" ("status", "createdAt");

CREATE INDEX "LedgerTransaction_referenceType_referenceId_idx" ON "LedgerTransaction" ("referenceType", "referenceId");

CREATE INDEX "LedgerEntry_accountId_createdAt_idx" ON "LedgerEntry" ("accountId", "createdAt");

CREATE INDEX "LedgerEntry_transactionId_idx" ON "LedgerEntry" ("transactionId");

CREATE INDEX "DriverEarning_driverId_idx" ON "DriverEarning" ("driverId");

CREATE INDEX "AgentProfile_status_cityId_idx" ON "AgentProfile" ("status", "cityId");

CREATE INDEX "AgentProfile_createdById_idx" ON "AgentProfile" ("createdById");

CREATE INDEX "Payment_userId_idx" ON "Payment" ("userId");

CREATE INDEX "Payment_provider_status_createdAt_idx" ON "Payment" ("provider", "status", "createdAt");

CREATE INDEX "Payment_status_createdAt_idx" ON "Payment" ("status", "createdAt");

CREATE INDEX "PaymentEvent_paymentId_createdAt_idx" ON "PaymentEvent" ("paymentId", "createdAt");

CREATE INDEX "PaymentEvent_type_createdAt_idx" ON "PaymentEvent" ("type", "createdAt");

CREATE INDEX "WalletTransaction_walletId_createdAt_idx" ON "WalletTransaction" ("walletId", "createdAt");

CREATE INDEX "DriverFundingRequest_driverId_status_idx" ON "DriverFundingRequest" ("driverId", "status");

CREATE INDEX "DriverFundingRequest_requestedById_createdAt_idx" ON "DriverFundingRequest" ("requestedById", "createdAt");

CREATE INDEX "DriverFundingRequest_status_createdAt_idx" ON "DriverFundingRequest" ("status", "createdAt");

CREATE INDEX "WithdrawRequest_driverId_idx" ON "WithdrawRequest" ("driverId");

CREATE INDEX "WithdrawRequest_status_createdAt_idx" ON "WithdrawRequest" ("status", "createdAt");

CREATE INDEX "WithdrawRequest_userId_status_idx" ON "WithdrawRequest" ("userId", "status");

CREATE INDEX "Notification_userId_idx" ON "Notification" ("userId");

CREATE INDEX "Notification_target_idx" ON "Notification" ("target");

CREATE INDEX "SupportTicket_status_idx" ON "SupportTicket" ("status");

CREATE INDEX "SupportMessage_ticketId_idx" ON "SupportMessage" ("ticketId");

CREATE INDEX "Rating_targetId_idx" ON "Rating" ("targetId");

CREATE INDEX "Rating_tripId_idx" ON "Rating" ("tripId");

CREATE INDEX "Complaint_status_idx" ON "Complaint" ("status");

CREATE INDEX "Zone_cityId_idx" ON "Zone" ("cityId");

CREATE INDEX "PricingRule_cityId_idx" ON "PricingRule" ("cityId");

CREATE INDEX "PeakPricing_pricingRuleId_idx" ON "PeakPricing" ("pricingRuleId");

CREATE INDEX "EmergencyContact_userId_idx" ON "EmergencyContact" ("userId");

CREATE INDEX "AppVersion_platform_idx" ON "AppVersion" ("platform");

CREATE INDEX "DeviceToken_userId_idx" ON "DeviceToken" ("userId");

CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken" ("userId");

CREATE INDEX "RefreshToken_userId_revoked_idx" ON "RefreshToken" ("userId", "revoked");

CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken" ("expiresAt");

CREATE INDEX "Session_userId_idx" ON "Session" ("userId");

CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog" ("actorId");

CREATE INDEX "AuditLog_entity_idx" ON "AuditLog" ("entity");

CREATE INDEX "ActivityLog_userId_idx" ON "ActivityLog" ("userId");

CREATE INDEX "SystemLog_level_idx" ON "SystemLog" ("level");

CREATE INDEX "VehicleCategory_isActive_idx" ON "VehicleCategory" ("isActive");

CREATE INDEX "VehicleCategory_domain_idx" ON "VehicleCategory" ("domain");

CREATE INDEX "VehicleCategory_deletedAt_idx" ON "VehicleCategory" ("deletedAt");

CREATE INDEX "VehicleType_isActive_idx" ON "VehicleType" ("isActive");

CREATE INDEX "VehicleType_categoryId_idx" ON "VehicleType" ("categoryId");

CREATE INDEX "VehicleType_status_idx" ON "VehicleType" ("status");

CREATE INDEX "VehicleType_deletedAt_idx" ON "VehicleType" ("deletedAt");

CREATE INDEX "Feature_isActive_idx" ON "Feature" ("isActive");

CREATE INDEX "Feature_deletedAt_idx" ON "Feature" ("deletedAt");

CREATE INDEX "VehicleTypeFeature_featureId_idx" ON "VehicleTypeFeature" ("featureId");

CREATE INDEX "ServiceArea_isActive_idx" ON "ServiceArea" ("isActive");

CREATE INDEX "ServiceArea_deletedAt_idx" ON "ServiceArea" ("deletedAt");

CREATE INDEX "VehiclePricingRule_vehicleTypeId_idx" ON "VehiclePricingRule" ("vehicleTypeId");

CREATE INDEX "VehiclePricingRule_serviceAreaId_idx" ON "VehiclePricingRule" ("serviceAreaId");

CREATE INDEX "VehiclePricingRule_isActive_idx" ON "VehiclePricingRule" ("isActive");

CREATE INDEX "VehiclePricingRule_deletedAt_idx" ON "VehiclePricingRule" ("deletedAt");

CREATE INDEX "VehicleTypeField_vehicleTypeId_idx" ON "VehicleTypeField" ("vehicleTypeId");

CREATE INDEX "Advertisement_placement_isActive_idx" ON "Advertisement" ("placement", "isActive");
