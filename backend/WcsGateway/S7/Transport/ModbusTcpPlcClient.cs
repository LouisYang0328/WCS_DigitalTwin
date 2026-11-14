using System.Buffers.Binary;
using System.Net;
using FluentModbus;

namespace WcsGateway.S7.Transport;

/// <summary>
/// Read-only Modbus TCP master. Register reads are converted to big-endian bytes so the
/// shared tag decoders (big-endian UInt16/UInt32) work unchanged; coil/discrete reads are
/// packed LSB-first per the Modbus wire convention.
/// </summary>
internal sealed class ModbusTcpPlcClient(ConnectionConfig config) : IPlcClient
{
    private readonly ModbusTcpClient _client = new();

    public bool IsConnected => _client.IsConnected;

    public async Task OpenAsync(CancellationToken cancellationToken)
    {
        var endpoint = new IPEndPoint(IPAddress.Parse(config.IpAddress), config.Port);
        // FluentModbus 的 Connect 为同步方法；交由线程池执行以便套用会话的连接超时与取消。
        await Task.Run(() => _client.Connect(endpoint), cancellationToken);
    }

    public async Task<byte[]> ReadAsync(string area, int dbNumber, int startAddress, int lengthBytes, CancellationToken cancellationToken)
    {
        return area switch
        {
            "holding" => RegistersToBytes(
                await _client.ReadHoldingRegistersAsync<short>(config.UnitId, startAddress, (lengthBytes + 1) / 2, cancellationToken),
                lengthBytes),
            "input" => RegistersToBytes(
                await _client.ReadInputRegistersAsync<short>(config.UnitId, startAddress, (lengthBytes + 1) / 2, cancellationToken),
                lengthBytes),
            "coil" => BitsToBytes(
                await _client.ReadCoilsAsync(config.UnitId, startAddress, lengthBytes * 8, cancellationToken),
                lengthBytes),
            "discrete" => BitsToBytes(
                await _client.ReadDiscreteInputsAsync(config.UnitId, startAddress, lengthBytes * 8, cancellationToken),
                lengthBytes),
            _ => throw new ArgumentException($"Modbus TCP 不支持数据区 {area}。")
        };
    }

    private static byte[] RegistersToBytes(Memory<short> registers, int lengthBytes)
    {
        var bytes = new byte[Math.Min(lengthBytes, registers.Length * 2)];
        for (var index = 0; index < registers.Length && index * 2 < bytes.Length; index++)
            BinaryPrimitives.WriteUInt16BigEndian(bytes.AsSpan(index * 2), (ushort)registers.Span[index]);
        return bytes;
    }

    private static byte[] BitsToBytes(Memory<byte> bits, int lengthBytes)
    {
        var bytes = new byte[lengthBytes];
        var bitCount = lengthBytes * 8;
        if (bits.Length == bitCount)
        {
            // 每位一个字节（0/1），按 Modbus 线序打包为 LSB 优先。
            for (var bit = 0; bit < bitCount; bit++)
                if (bits.Span[bit] != 0)
                    bytes[bit / 8] |= (byte)(1 << (bit % 8));
        }
        else
        {
            // 已是打包字节，按原样截断/补齐。
            Array.Copy(bits.Span.ToArray(), bytes, Math.Min(bits.Length, lengthBytes));
        }
        return bytes;
    }

    public void Dispose() => _client.Dispose();
}
