namespace WcsGateway.S7.Transport;

// 会话负责轮询和重连；协议适配器只负责连接及只读字节访问。
public interface IPlcClient : IDisposable
{
    bool IsConnected { get; }
    Task OpenAsync(CancellationToken cancellationToken);
    /// <summary>
    /// Reads <paramref name="lengthBytes"/> bytes from a protocol data area.
    /// S7 uses area "db" with <paramref name="dbNumber"/>; Modbus maps area to
    /// holding/input registers (length in bytes, 2 per register) or coil/discrete bits (8 per byte).
    /// </summary>
    Task<byte[]> ReadAsync(string area, int dbNumber, int startAddress, int lengthBytes, CancellationToken cancellationToken);
}

public interface IPlcClientFactory
{
    IPlcClient Create(ConnectionConfig config);
}
