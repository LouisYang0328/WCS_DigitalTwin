using System.Buffers.Binary;
using System.Text.Json;
using System.Text.Json.Nodes;
using WcsGateway.Configuration;
using WcsGateway.S7;
using WcsGateway.S7.Profiles;

var directory = new DirectoryInfo(Directory.GetCurrentDirectory());
while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "backend", "WcsGateway", "config", "plc-profiles.json")))
    directory = directory.Parent;
var root = directory?.FullName ?? throw new InvalidOperationException("Run this check from inside the repository.");
var profilePath = Path.Combine(root, "backend", "WcsGateway", "config", "plc-profiles.json");
var profiles = new S7ProfileRegistry(profilePath);
var tc = profiles.Get("tc") ?? throw new InvalidOperationException("TC profile missing.");

Equal(29, tc.Tags.Count, "TC feedback count");
Equal(2000, tc.DefaultDbNumber, "TC default DB");
Equal(0, tc.DefaultStartAddress, "TC default start");
Equal(70, tc.ReadLength, "TC complete read range");
Equal(500, tc.DefaultPollIntervalMs, "TC polling default");
Equal(0, profiles.Decode("raw", new byte[1], 0).Count, "RAW must not fabricate tags");

// Verify decoding and full unsigned range independently of the profile's actual offsets.
var bytes = new byte[70];
BinaryPrimitives.WriteUInt16BigEndian(bytes.AsSpan(0), 0xA1B2);
BinaryPrimitives.WriteUInt32BigEndian(bytes.AsSpan(20), uint.MaxValue);
BinaryPrimitives.WriteUInt32BigEndian(bytes.AsSpan(50), 12345678);
BinaryPrimitives.WriteUInt32BigEndian(bytes.AsSpan(54), 87654321);
BinaryPrimitives.WriteUInt32BigEndian(bytes.AsSpan(58), 70000);
bytes[62] = 0xFF;
bytes[63] = 0xFF;
BinaryPrimitives.WriteUInt16BigEndian(bytes.AsSpan(64), 0x1122);
BinaryPrimitives.WriteUInt32BigEndian(bytes.AsSpan(66), 0xCCDDEEFF);
var tags = profiles.Decode("tc", bytes, 100).ToDictionary(tag => tag.Name);
Equal(29, tags.Count, "Complete feedback decode");
Equal(0xA1B2u, tags["PLC_HEARTBEAT"].Value, "UInt16 byte order");
Equal(uint.MaxValue, tags["PLC_TASK"].Value, "UInt32 full range");
Equal(12345678u, tags["PLC_LOCATX"].Value, "Walking offset 50");
Equal(87654321u, tags["PLC_LOCATY"].Value, "Lift offset 54");
Equal(70000u, tags["PLC_LOCATZ"].Value, "Fork offset 58");
Equal(0x1122u, tags["PLC_RELEASEFINISH"].Value, "Reserved-byte gap then release offset 64");
Equal(0xCCDDEEFFu, tags["PLC_TASKNO"].Value, "Second task offset 66");
Equal("DBW100", tags["PLC_HEARTBEAT"].Address, "Shifted word address");
Equal("DBD166", tags["PLC_TASKNO"].Address, "Shifted dword address");
Throws<ArgumentException>(() => profiles.Decode("tc", new byte[69], 0), "Short read must fail as a whole");
Throws<ArgumentException>(() => profiles.Decode("tc", bytes, 65500), "DB end overflow");
Throws<ArgumentException>(() => profiles.Decode("missing", bytes, 0), "Unknown decoder");
Throws<ArgumentOutOfRangeException>(() => TcTagDecoder.ReadUInt32BigEndian(bytes, int.MaxValue), "Offset arithmetic overflow");

// S7 STRING keeps its leading zeroes and rejects malformed wire headers instead
// of replacing invalid bytes or exposing a partially decoded successful block.
var stringBytes = new byte[12];
stringBytes[0] = 10;
stringBytes[1] = 10;
System.Text.Encoding.ASCII.GetBytes("0000123456").CopyTo(stringBytes, 2);
Equal("0000123456", TcTagDecoder.ReadS7String(stringBytes, 0, 10), "S7 String preserves leading zeroes");
Equal("", TcTagDecoder.ReadS7String(new byte[] { 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 }, 0, 10), "Empty S7 String");
var badString = stringBytes.ToArray();
badString[0] = 9;
Throws<ArgumentException>(() => TcTagDecoder.ReadS7String(badString, 0, 10), "S7 String header capacity mismatch");
badString[0] = 10;
badString[1] = 11;
Throws<ArgumentException>(() => TcTagDecoder.ReadS7String(badString, 0, 10), "S7 String length exceeds capacity");
badString[1] = 1;
badString[2] = 0x80;
Throws<ArgumentException>(() => TcTagDecoder.ReadS7String(badString, 0, 10), "S7 String rejects non-ASCII wire bytes");
Throws<ArgumentOutOfRangeException>(() => TcTagDecoder.ReadS7String(new byte[11], 0, 10), "S7 String truncated capacity");
Throws<ArgumentOutOfRangeException>(() => TcTagDecoder.ReadS7String(stringBytes, int.MaxValue, 10), "S7 String offset overflow");
Throws<ArgumentOutOfRangeException>(() => TcTagDecoder.ReadS7String(stringBytes, 0, 255), "S7 String capacity limit");

var quick = ConnectionRequestValidator.Validate(new ConnectionRequest
{
    Name = "TC01", IpAddress = "192.0.2.10", ProfileId = "tc"
}, profiles);
Equal(1, quick.Blocks.Count, "Profile provision creates one block");
Equal("tc", quick.Blocks[0].Decoder, "Profile provision decoder");
Equal(70, quick.Blocks[0].ReadLength, "Profile provision read length");
Equal(102, quick.Port, "Profile provision standard S7 port");
Throws<ArgumentException>(() => ConnectionRequestValidator.Validate(new ConnectionRequest
{
    Name = "TC01", IpAddress = "192.0.2.10", Blocks = []
}, profiles), "Existing empty block contract");
Throws<ArgumentException>(() => ConnectionRequestValidator.Validate(new ConnectionRequest
{
    Name = "TC01", IpAddress = "192.0.2.10", ProfileId = "missing"
}, profiles), "Unknown profile provisioning");
Throws<ArgumentException>(() => ConnectionRequestValidator.Validate(new ConnectionRequest
{
    Name = "TC01", IpAddress = "192.0.2.10",
    Blocks = [new() { Name = "Truncated TC", ReadLength = 69 }]
}, profiles), "TC block must cover all signals");

// Modbus TCP protocol validation: station address, register areas and byte-count rules.
var modbus = ConnectionRequestValidator.Validate(new ConnectionRequest
{
    Protocol = "modbus-tcp", Name = "MB01", IpAddress = "192.0.2.20", Port = 502, UnitId = 3,
    Blocks = [new() { Name = "保持寄存器", Area = "holding", StartAddress = 100, ReadLength = 70, Decoder = "tc" }]
}, profiles);
Equal("modbus-tcp", modbus.Protocol, "Modbus protocol id");
Equal(3, modbus.UnitId, "Modbus unit id");
Equal(0, modbus.Rack, "Modbus rack unused");
Equal("Modbus TCP", modbus.CpuType, "Modbus CPU placeholder");
Equal(0, modbus.Blocks[0].DbNumber, "Modbus DB number unused");
Equal("holding", modbus.Blocks[0].Area, "Modbus holding area");
Equal(29, profiles.Decode(modbus.Blocks[0].Decoder, bytes, 0).Count, "Modbus block decodes like S7 bytes");
Throws<ArgumentException>(() => ConnectionRequestValidator.Validate(new ConnectionRequest
{
    Protocol = "modbus-tcp", Name = "MB02", IpAddress = "192.0.2.21", UnitId = 300,
    Blocks = [new() { Name = "HR", Area = "holding", ReadLength = 32, Decoder = "raw" }]
}, profiles), "Modbus unit id range");
Throws<ArgumentException>(() => ConnectionRequestValidator.Validate(new ConnectionRequest
{
    Protocol = "modbus-tcp", Name = "MB03", IpAddress = "192.0.2.22",
    Blocks = [new() { Name = "HR", Area = "holding", ReadLength = 31, Decoder = "raw" }]
}, profiles), "Modbus register read length must be even");
Throws<ArgumentException>(() => ConnectionRequestValidator.Validate(new ConnectionRequest
{
    Protocol = "modbus-tcp", Name = "MB04", IpAddress = "192.0.2.23",
    Blocks = [new() { Name = "DB?", Area = "db", DbNumber = 600, ReadLength = 32, Decoder = "raw" }]
}, profiles), "Modbus rejects the S7 db area");
Throws<ArgumentException>(() => ConnectionRequestValidator.Validate(new ConnectionRequest
{
    Protocol = "modbus-tcp", Name = "MB05", IpAddress = "192.0.2.24",
    Blocks = [new() { Name = "HR", Area = "holding", StartAddress = 65530, ReadLength = 32, Decoder = "raw" }]
}, profiles), "Modbus register range overflow");
Throws<ArgumentException>(() => ConnectionRequestValidator.Validate(new ConnectionRequest
{
    Protocol = "modbus-plus", Name = "MB06", IpAddress = "192.0.2.25",
    Blocks = [new() { Name = "HR", Area = "holding", ReadLength = 32, Decoder = "raw" }]
}, profiles), "Unknown protocol rejected");
var coils = ConnectionRequestValidator.Validate(new ConnectionRequest
{
    Protocol = "modbus-tcp", Name = "MB07", IpAddress = "192.0.2.26",
    Blocks = [new() { Name = "线圈", Area = "coil", StartAddress = 16, ReadLength = 3, Decoder = "raw" }]
}, profiles);
Equal("coil", coils.Blocks[0].Area, "Modbus coil bit area allows odd byte count");
Console.WriteLine("PASS: Modbus TCP protocol/area/unit validation and shared decoder reuse.");

var tempDirectory = Path.GetFullPath(Path.Combine(Path.GetTempPath(), "wcs-profile-checks-" + Guid.NewGuid().ToString("N")));
Directory.CreateDirectory(tempDirectory);
try
{
    string OwnedPath(string fileName)
    {
        var path = Path.GetFullPath(Path.Combine(tempDirectory, fileName));
        if (!string.Equals(Path.GetDirectoryName(path), tempDirectory, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Test path escaped the test-owned directory.");
        return path;
    }

    void RejectMutation(Action<JsonObject> mutate, string label)
    {
        var document = JsonNode.Parse(File.ReadAllText(profilePath))!.AsObject();
        mutate(document);
        var path = Path.Combine(tempDirectory, "invalid.json");
        File.WriteAllText(path, document.ToJsonString());
        Throws<InvalidOperationException>(() => new S7ProfileRegistry(path), label);
    }
    RejectMutation(document => document["version"] = 2, "Future config version");
    RejectMutation(document => document["unknownSetting"] = true, "Unknown config property");
    RejectMutation(document => document["profiles"]![0]!["tags"]![0]!["offset"] = -1, "Negative tag offset");
    RejectMutation(document => document["profiles"]![0]!["tags"]![0]!["dataType"] = "Uint16", "Misspelled data type");
    RejectMutation(document => document["profiles"]![0]!["tags"]![1]!["offset"] = 0, "Overlapping tag byte ranges");
    RejectMutation(document => document["profiles"]![0]!["tags"]![1]!["name"] = "PLC_HEARTBEAT", "Duplicate point name");
    RejectMutation(document => document["profiles"]![0]!["tags"]![28]!["offset"] = 68, "Tag end outside read range");
    RejectMutation(document => document["profiles"]!.AsArray().Add(document["profiles"]![0]!.DeepClone()), "Duplicate profile ID");

    // A new family and altered address must work without touching any C# decoder.
    var customDocument = JsonNode.Parse(File.ReadAllText(profilePath))!.AsObject();
    customDocument["profiles"]!.AsArray().Add(JsonNode.Parse("""
    {"id":"conveyor","name":"Conveyor","defaultDbNumber":3001,"defaultStartAddress":32,"readLength":8,"defaultPollIntervalMs":1000,
     "tags":[{"name":"STATE","offset":6,"dataType":"UInt16","description":"Status"}]}
    """));
    var customPath = Path.Combine(tempDirectory, "custom.json");
    File.WriteAllText(customPath, customDocument.ToJsonString());
    var customRegistry = new S7ProfileRegistry(customPath);
    var customBytes = new byte[] { 0, 0, 0, 0, 0, 0, 0x12, 0x34 };
    var customTag = customRegistry.Decode("conveyor", customBytes, 32).Single();
    Equal("DBW38", customTag.Address, "Custom profile shifted offset");
    Equal(0x1234u, customTag.Value, "Custom profile decoder");
    var customConnection = ConnectionRequestValidator.Validate(new ConnectionRequest
    {
        Name = "CV01", IpAddress = "192.0.2.11", ProfileId = "conveyor"
    }, customRegistry);
    Equal(3001, customConnection.Blocks[0].DbNumber, "Custom provisioning DB");
    Equal(32, customConnection.Blocks[0].StartAddress, "Custom provisioning base address");

    customDocument["profiles"]!.AsArray().Add(JsonNode.Parse("""
    {"id":"string-sample","name":"String sample","defaultDbNumber":600,"defaultStartAddress":32,"readLength":14,"defaultPollIntervalMs":500,
     "tags":[{"name":"STATE","offset":0,"dataType":"UInt16"},{"name":"TRAY","offset":2,"dataType":"String","length":10}]}
    """));
    var stringProfilePath = Path.Combine(tempDirectory, "string-profile.json");
    File.WriteAllText(stringProfilePath, customDocument.ToJsonString());
    var stringProfiles = new S7ProfileRegistry(stringProfilePath);
    var mixedBytes = new byte[14];
    mixedBytes[1] = 2;
    stringBytes.CopyTo(mixedBytes, 2);
    var mixedTags = stringProfiles.Decode("string-sample", mixedBytes, 32).ToDictionary(tag => tag.Name);
    Equal(2u, mixedTags["STATE"].Value, "Mixed profile keeps numeric values as UInt32");
    Equal("0000123456", mixedTags["TRAY"].Value, "Mixed String profile preserves leading zeroes");
    Equal("DBB34", mixedTags["TRAY"].Address, "String byte address includes the two-byte header");
    Equal(10, mixedTags["TRAY"].Length, "String tag exposes character capacity");
    mixedBytes[3] = 11;
    Throws<ArgumentException>(() => stringProfiles.Decode("string-sample", mixedBytes, 32), "Malformed String invalidates the whole mixed block");
    foreach (var invalidCapacity in new int?[] { null, 0, 255 })
    {
        customDocument["profiles"]!.AsArray().Last()!["tags"]![1]!["length"] = invalidCapacity;
        File.WriteAllText(stringProfilePath, customDocument.ToJsonString());
        Throws<InvalidOperationException>(() => new S7ProfileRegistry(stringProfilePath), "String profile rejects missing/invalid capacity");
    }
    customDocument["profiles"]!.AsArray().Last()!["tags"]![1]!["length"] = 11;
    File.WriteAllText(stringProfilePath, customDocument.ToJsonString());
    Throws<InvalidOperationException>(() => new S7ProfileRegistry(stringProfilePath), "String profile rejects capacity beyond the block boundary");
    Console.WriteLine("PASS: S7 String header/capacity/ASCII validation, mixed numeric decoding, shifted byte addresses and leading-zero preservation.");

    var storePath = OwnedPath("connections.json");
    var store = new ConnectionConfigStore(storePath, profiles);
    Equal(0, store.Load().Count, "Missing store starts empty");
    var savedDevice = quick with { Id = "plc-storage-check", Enabled = false };
    store.Save([savedDevice]);
    var savedJson = File.ReadAllText(storePath);
    var savedDocument = JsonNode.Parse(savedJson)!;
    Equal(2, savedDocument["version"]!.GetValue<int>(), "Saved schema version");
    var reloaded = store.Load().Single();
    Equal(savedDevice.Id, reloaded.Id, "V2 ID round trip");
    Equal(savedDevice.IpAddress, reloaded.IpAddress, "V2 endpoint round trip");
    Equal(false, reloaded.Enabled, "V2 enabled round trip");
    Equal(savedDevice.Blocks[0].Id, reloaded.Blocks[0].Id, "V2 block ID round trip");
    Equal(70, reloaded.Blocks[0].ReadLength, "V2 read length round trip");
    Equal("s7", reloaded.Protocol, "V2 store defaults to S7 protocol");
    Equal("db", reloaded.Blocks[0].Area, "V2 store defaults to db area");

    store.Save([savedDevice, modbus with { Id = "plc-modbus-check" }]);
    var reloadedModbus = store.Load().Single(item => item.Id == "plc-modbus-check");
    Equal("modbus-tcp", reloadedModbus.Protocol, "Modbus protocol round trip");
    Equal(3, reloadedModbus.UnitId, "Modbus unit id round trip");
    Equal("holding", reloadedModbus.Blocks[0].Area, "Modbus area round trip");
    Equal(502, reloadedModbus.Port, "Modbus port round trip");
    store.Save([savedDevice]);

    void RejectStore<T>(Action<JsonObject> mutate, string label) where T : Exception
    {
        var document = JsonNode.Parse(savedJson)!.AsObject();
        mutate(document);
        var json = document.ToJsonString();
        File.WriteAllText(storePath, json);
        Throws<T>(() => store.Load(), label);
        Equal(json, File.ReadAllText(storePath), label + " must preserve source bytes");
    }
    RejectStore<InvalidDataException>(document => document["version"] = 9, "Unknown store version");
    RejectStore<InvalidDataException>(document => document["devices"] = null, "Null store devices");
    RejectStore<InvalidDataException>(document => document["devices"]!.AsArray().Add(document["devices"]![0]!.DeepClone()), "Duplicate device ID");
    RejectStore<InvalidDataException>(document =>
    {
        var duplicate = document["devices"]![0]!.DeepClone();
        duplicate["id"] = "plc-another-id";
        document["devices"]!.AsArray().Add(duplicate);
    }, "Duplicate network endpoint");
    RejectStore<ArgumentException>(document => document["devices"]![0]!["blocks"]![0]!["readLength"] = 69, "Incomplete persisted TC block");
    const string corruptJson = "{\"version\":2,\"devices\":[";
    File.WriteAllText(storePath, corruptJson);
    Throws<JsonException>(() => store.Load(), "Corrupt store must fail loading");
    Equal(corruptJson, File.ReadAllText(storePath), "Corrupt store source preservation");

    var legacyPath = OwnedPath("legacy.json");
    var legacyStore = new ConnectionConfigStore(legacyPath, profiles);
    var legacy = JsonNode.Parse(File.ReadAllText(Path.Combine(root, "tests", "fixtures", "legacy-connections.json")))!.AsArray();
    legacy[0]!["enabled"] = false;
    File.WriteAllText(legacyPath, legacy.ToJsonString());
    var migrated = legacyStore.Load().Single();
    Equal("plc-legacy-migration", migrated.Id, "Legacy device ID retained");
    Equal(false, migrated.Enabled, "Legacy disconnected state retained");
    Equal("tc", migrated.Blocks.Single().Decoder, "Legacy TC profile recognition");
    var migratedId = migrated.Blocks[0].Id;
    var migratedJson = JsonNode.Parse(File.ReadAllText(legacyPath))!;
    Equal(2, migratedJson["version"]!.GetValue<int>(), "Legacy migration persists V2");
    Equal(migratedId, legacyStore.Load().Single().Blocks[0].Id, "Migration block IDs stabilize after first load");

    // Failed migration must not rewrite its original source into a partial V2 file.
    var duplicateLegacy = legacy[0]!.DeepClone();
    duplicateLegacy["id"] = "legacy-duplicate-endpoint";
    legacy.Add(duplicateLegacy);
    var invalidLegacyJson = legacy.ToJsonString();
    File.WriteAllText(legacyPath, invalidLegacyJson);
    Throws<InvalidDataException>(() => legacyStore.Load(), "Invalid legacy migration rejects duplicate endpoint");
    Equal(invalidLegacyJson, File.ReadAllText(legacyPath), "Failed migration preserves original JSON");

    store.Save([savedDevice]);
    var beforeFailedSave = File.ReadAllText(storePath);
    Throws<IOException>(() => store.Save(FailingConfigs(savedDevice)), "Failed enumeration during save");
    Equal(beforeFailedSave, File.ReadAllText(storePath), "Failed save preserves previous target");
    Equal(false, File.Exists(OwnedPath("connections.json.tmp")), "Failed save removes temporary file");
    if (OperatingSystem.IsWindows())
    {
        // Disallow replacement while still allowing reads, forcing failure at the final commit.
        using (var lockedTarget = new FileStream(storePath, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            ThrowsStorage(() => store.Save([savedDevice with { Name = "Must not be committed" }]), "Locked target final rename failure");
            Equal(beforeFailedSave, File.ReadAllText(storePath), "Failed final rename preserves previous target");
        }
        Equal(false, File.Exists(OwnedPath("connections.json.tmp")), "Failed rename removes temporary file");
    }
    Console.WriteLine("PASS: V2 persistence, legacy migration, duplicate/invalid/corrupt rejection, original-file preservation and atomic-save failure recovery.");
}
finally
{
    var temporaryRoot = Path.GetFullPath(Path.GetTempPath());
    if (!string.Equals(Path.GetDirectoryName(tempDirectory)?.TrimEnd(Path.DirectorySeparatorChar),
        temporaryRoot.TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase) ||
        !Path.GetFileName(tempDirectory).StartsWith("wcs-profile-checks-", StringComparison.Ordinal))
        throw new InvalidOperationException("Refusing to clean an unexpected test directory.");
    // Enumerate and verify immediate task-owned files; never perform a recursive delete.
    foreach (var path in Directory.GetFiles(tempDirectory))
    {
        var fullPath = Path.GetFullPath(path);
        if (!string.Equals(Path.GetDirectoryName(fullPath), tempDirectory, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Refusing to clean a file outside the test directory.");
        File.Delete(fullPath);
    }
    Directory.Delete(tempDirectory);
}

Console.WriteLine("PASS: TC 29-point decoding, endianness, UInt32 range, reserved gap, shifted addresses, strict validation and custom profiles.");

static void Equal<T>(T expected, T actual, string label)
{
    if (!EqualityComparer<T>.Default.Equals(expected, actual))
        throw new InvalidOperationException($"{label}: expected {expected}, got {actual}.");
}

static void Throws<T>(Action action, string label) where T : Exception
{
    try { action(); }
    catch (T) { return; }
    throw new InvalidOperationException($"{label}: expected {typeof(T).Name}.");
}

static IEnumerable<ConnectionConfig> FailingConfigs(ConnectionConfig first)
{
    yield return first;
    throw new IOException("Synthetic configuration source failure.");
}

static void ThrowsStorage(Action action, string label)
{
    try { action(); }
    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return; }
    throw new InvalidOperationException($"{label}: expected a storage access failure.");
}
