using S7.Net;

namespace WcsGateway.S7.Transport;

internal sealed class S7NetPlcClient(ConnectionConfig config) : IPlcClient
{
    private readonly Plc _client = new(config.ParseCpuType(), config.IpAddress, config.Port, config.Rack, config.Slot);

    public bool IsConnected => _client.IsConnected;
    public Task OpenAsync(CancellationToken cancellationToken) => _client.OpenAsync(cancellationToken);
    public Task<byte[]> ReadAsync(string area, int dbNumber, int startAddress, int lengthBytes, CancellationToken cancellationToken)
    {
        if (!string.Equals(area, "db", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException($"S7 协议不支持数据区 {area}。");
        return _client.ReadBytesAsync(DataType.DataBlock, dbNumber, startAddress, lengthBytes, cancellationToken);
    }
    public void Dispose() => _client.Close();
}
